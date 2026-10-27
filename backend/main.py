
import json
import os
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pymupdf
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware


# --------------------------------------------------
# 1. CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
DB_PATH = BASE_DIR / "docusure.db"

load_dotenv(dotenv_path=ENV_FILE, override=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv(
    "GROQ_MODEL",
    "openai/gpt-oss-120b",
).strip()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_AI_TEXT_LENGTH = 18000

app = FastAPI(
    title="DocuSure AI API",
    description=(
        "AI-assisted document analysis, preliminary validation, "
        "and document history storage."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# 2. SQLITE DATABASE
# --------------------------------------------------

def get_db_connection():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_db_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                pages INTEGER NOT NULL DEFAULT 0,
                characters_extracted INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                ai_status TEXT NOT NULL,
                findings_json TEXT NOT NULL,
                ai_analysis_json TEXT,
                created_at TEXT NOT NULL
            )
        """)


def save_document(result: dict[str, Any]) -> int:
    """Save analysis results and return the database record ID."""
    with get_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO documents (
                filename,
                pages,
                characters_extracted,
                status,
                ai_status,
                findings_json,
                ai_analysis_json,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["filename"],
                result["pages"],
                result["characters_extracted"],
                result["status"],
                result["ai_status"],
                json.dumps(
                    result["findings"],
                    ensure_ascii=False,
                ),
                json.dumps(
                    result["ai_analysis"],
                    ensure_ascii=False,
                ),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        return cursor.lastrowid


def list_documents(limit: int = 50) -> list[dict]:
    with get_db_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, filename, pages, characters_extracted,
                   status, ai_status, created_at
            FROM documents
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [dict(row) for row in rows]


def get_document(document_id: int):
    with get_db_connection() as connection:
        row = connection.execute(
            "SELECT * FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()

    if row is None:
        return None

    document = dict(row)

    document["findings"] = json.loads(
        document.pop("findings_json")
    )

    document["ai_analysis"] = json.loads(
        document.pop("ai_analysis_json") or "null"
    )

    return document


# Create the database table when the application starts.
init_db()


# --------------------------------------------------
# 3. BASIC DOCUMENT CHECKS
# --------------------------------------------------

def basic_findings(text: str) -> list[str]:
    findings = []
    normalized = text.lower()

    if not text.strip():
        findings.append(
            "No selectable text was extracted. "
            "The PDF may be scanned or image-based; OCR is needed."
        )
        return findings

    placeholder_terms = [
        "fictional test sample",
        "test data only",
        "placeholder",
        "sample document",
        "created for software testing",
        "not an official document",
        "fictional value",
    ]

    if any(term in normalized for term in placeholder_terms):
        findings.append(
            "Test or placeholder content detected. "
            "Do not treat this document as authentic."
        )

    known_document_terms = [
        "application",
        "certificate",
        "declaration",
        "identity",
        "institution",
        "approval",
        "address",
        "license",
        "registration",
        "invoice",
        "report",
    ]

    if not any(term in normalized for term in known_document_terms):
        findings.append(
            "Document type could not be confidently identified "
            "using basic keyword checks."
        )

    # Preliminary expiry check. This does not establish validity.
    expiry_patterns = [
        r"(?:expiry date|expiration date|valid until|valid through)"
        r"\s*[:\-]?\s*"
        r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})",

        r"(?:expiry date|expiration date|valid until|valid through)"
        r"\s*[:\-]?\s*"
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
    ]

    for pattern in expiry_patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            date_text = match.group(1).strip()
            parsed_date = None

            for fmt in (
                "%d %B %Y",
                "%d %b %Y",
                "%d/%m/%Y",
                "%d-%m-%Y",
                "%m/%d/%Y",
            ):
                try:
                    parsed_date = datetime.strptime(
                        date_text, fmt
                    ).date()
                    break
                except ValueError:
                    continue

            if parsed_date and parsed_date < date.today():
                findings.append(
                    f"A date that may indicate expiry appears to be "
                    f"in the past: {date_text}. Verify the applicable "
                    "expiry field and date format manually."
                )

    if not findings:
        findings.append(
            "No obvious issues were detected by the basic checks. "
            "This does not prove authenticity or compliance."
        )

    return findings


# --------------------------------------------------
# 4. AI RESPONSE PARSING
# --------------------------------------------------

def extract_json(content: str) -> dict:
    content = content.strip()

    if content.startswith("```"):
        content = re.sub(
            r"^```(?:json)?\s*",
            "",
            content,
            flags=re.IGNORECASE,
        )
        content = re.sub(r"\s*```$", "", content)

    start = content.find("{")
    end = content.rfind("}")

    if start == -1 or end == -1 or end < start:
        raise ValueError("AI response did not contain a JSON object.")

    return json.loads(content[start:end + 1])


# --------------------------------------------------
# 5. GROQ AI ANALYSIS
# --------------------------------------------------

async def analyze_with_ai(text: str):
    if not GROQ_API_KEY:
        print("Groq AI unavailable: GROQ_API_KEY is not configured.")
        return None

    if not text.strip():
        return None

    document_text = text[:MAX_AI_TEXT_LENGTH]

    prompt = f"""
You are DocuSure AI, a preliminary document-review assistant.

Analyze the supplied document text and return ONLY a valid JSON object
with these exact keys:

{{
  "summary": "Short summary",
  "document_type": "Likely document type",
  "key_fields": {{
    "field_name": "extracted value"
  }},
  "potential_issues": [
    "Potential issue"
  ],
  "recommended_actions": [
    "Recommended next step"
  ],
  "review_recommendation": "Manual Review Required"
}}

Instructions:
- Extract only information present in the document.
- Do not invent missing values.
- Identify obvious placeholders, contradictions, missing evidence,
  and potentially expired dates where supported by the text.
- Treat suspicious content as an indicator requiring verification,
  not proof of fraud.
- Never claim that a document is authentic or officially compliant.
- Do not claim to have contacted a government department or verified
  a document against an external database.
- If the document is fictional, a sample, or a placeholder, state so.
- Prefer "Manual Review Required" when evidence is incomplete.
- Use concise, clear language.

DOCUMENT TEXT:
---
{document_text}
---
"""

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You perform cautious, evidence-based preliminary "
                    "document analysis. Return valid JSON only."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "temperature": 0.1,
        "max_tokens": 1800,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
            )

        if response.status_code != 200:
            # Do not print the API key or request headers.
            print(
                f"Groq AI error: HTTP {response.status_code}: "
                f"{response.text[:1000]}"
            )
            return None

        response_data = response.json()
        content = response_data["choices"][0]["message"]["content"]
        analysis = extract_json(content)

        # Ensure the expected response fields exist.
        analysis.setdefault("summary", "No summary returned.")
        analysis.setdefault("document_type", "Unknown")
        analysis.setdefault("key_fields", {})
        analysis.setdefault("potential_issues", [])
        analysis.setdefault("recommended_actions", [])
        analysis.setdefault(
            "review_recommendation",
            "Manual Review Required",
        )

        if not isinstance(analysis["key_fields"], dict):
            analysis["key_fields"] = {}

        if not isinstance(analysis["potential_issues"], list):
            analysis["potential_issues"] = []

        if not isinstance(analysis["recommended_actions"], list):
            analysis["recommended_actions"] = []

        return analysis

    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        print(f"Groq AI request or response error: {exc}")
        return None
    except Exception as exc:
        print(f"Unexpected Groq AI error: {type(exc).__name__}: {exc}")
        return None


# --------------------------------------------------
# 6. BASIC API ROUTES
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to DocuSure AI API",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "project": "DocuSure AI",
        "ai_configured": bool(GROQ_API_KEY),
        "ai_model": GROQ_MODEL,
        "database": "SQLite",
        "database_file_exists": DB_PATH.exists(),
    }


# --------------------------------------------------
# 7. PDF UPLOAD, ANALYSIS, AND DATABASE STORAGE
# --------------------------------------------------

@app.post("/api/analyze")
async def analyze_document(file: UploadFile = File(...)):
    filename = Path(file.filename or "document.pdf").name

    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported.",
        )

    file_bytes = await file.read(MAX_FILE_SIZE + 1)
    await file.close()

    if not file_bytes:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty.",
        )

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="File exceeds the 10 MB upload limit.",
        )

    try:
        pdf_document = pymupdf.open(
            stream=file_bytes,
            filetype="pdf",
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file could not be opened as a valid PDF.",
        )

    try:
        if pdf_document.is_encrypted:
            raise HTTPException(
                status_code=400,
                detail="Password-protected PDFs are not supported.",
            )

        if pdf_document.page_count == 0:
            raise HTTPException(
                status_code=400,
                detail="The PDF contains no pages.",
            )

        page_count = pdf_document.page_count
        extracted_text_parts = []

        for page in pdf_document:
            extracted_text_parts.append(page.get_text("text"))

        extracted_text = "\n".join(extracted_text_parts).strip()

    finally:
        pdf_document.close()

    findings = basic_findings(extracted_text)

    ai_analysis = await analyze_with_ai(extracted_text)

    if ai_analysis is not None:
        ai_status = "success"
        status = ai_analysis.get(
            "review_recommendation",
            "Manual Review Required",
        )

        # Preserve the warning from deterministic checks.
        # AI output must not override a known placeholder warning.
        if any(
            "Test or placeholder content detected" in finding
            for finding in findings
        ):
            status = "Manual Review Required"

    elif not GROQ_API_KEY:
        ai_status = "not_configured"
        status = "Manual Review Required"

    else:
        ai_status = "unavailable"
        status = "Manual Review Required"

    result = {
        "filename": filename,
        "pages": page_count,
        "characters_extracted": len(extracted_text),
        "status": status,
        "findings": findings,
        "text_preview": extracted_text[:2000],
        "ai_status": ai_status,
        "ai_analysis": ai_analysis,
        "note": (
            "This is preliminary AI-assisted analysis, not proof of "
            "authenticity or official compliance. Verify documents with "
            "authorized sources and have an authorized reviewer make "
            "the final decision."
        ),
    }

    try:
        document_id = save_document(result)
        result["document_id"] = document_id
    except sqlite3.Error as exc:
        print(f"Database save error: {exc}")
        raise HTTPException(
            status_code=500,
            detail=(
                "Analysis completed, but the result could not be saved "
                "to the database. Check backend logs."
            ),
        )

    return result


# --------------------------------------------------
# 8. DOCUMENT HISTORY
# --------------------------------------------------

@app.get("/api/documents")
def documents_history(
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        documents = list_documents(limit)
        return {
            "documents": documents,
            "count": len(documents),
        }
    except sqlite3.Error as exc:
        print(f"Database history error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve document history.",
        )


@app.get("/api/documents/{document_id}")
def document_details(document_id: int):
    try:
        document = get_document(document_id)
    except sqlite3.Error as exc:
        print(f"Database detail error: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve the document record.",
        )

    if document is None:
        raise HTTPException(
            status_code=404,
            detail="Document record not found.",
        )

    return document
