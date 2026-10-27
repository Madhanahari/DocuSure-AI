
import json
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "docusure.db"


def get_connection():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as connection:
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


def save_document(result):
    """Save one completed document analysis and return its database ID."""
    with get_connection() as connection:
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
                result.get("filename", "unknown.pdf"),
                result.get("pages", 0),
                result.get("characters_extracted", 0),
                result.get("status", "Manual Review Required"),
                result.get("ai_status", "not_configured"),
                json.dumps(result.get("findings", []), ensure_ascii=False),
                json.dumps(result.get("ai_analysis"), ensure_ascii=False),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        return cursor.lastrowid


def list_documents(limit=50):
    """Return recent document records, newest first."""
    limit = max(1, min(int(limit), 200))

    with get_connection() as connection:
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


def get_document(document_id):
    """Return one saved record, including its analysis."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()

    if row is None:
        return None

    document = dict(row)
    document["findings"] = json.loads(document.pop("findings_json"))
    document["ai_analysis"] = json.loads(
        document.pop("ai_analysis_json") or "null"
    )
    return document
