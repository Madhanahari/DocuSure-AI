# DocuSure AI 🇮🇳
### AI-Powered Institutional Document Verification & Compliance Support

**Smart document analysis. Explainable findings. Reliable regulatory review.**

DocuSure AI is a student hackathon prototype designed to assist with institutional application verification by combining document text extraction, AI-assisted analysis, and preliminary compliance checks.

It aims to help reviewers identify missing information, expired certificates, inconsistencies, and potential document anomalies more efficiently.

> **Disclaimer:** DocuSure AI is an independent hackathon prototype, not an official AICTE or Government of India application. It does not replace authorized verification or regulatory decisions.

---

## 🎯 Problem Statement

**SIH26261:** AI-Powered Application Validation, Document Authentication and Regulatory Compliance Verification

Manually reviewing institutional applications and supporting documents can be time-consuming. Missing documents, expired certificates, inconsistent details, and potentially altered records may require additional verification.

DocuSure AI explores how AI and automated validation can support this review process.

## 💡 Proposed Solution

The prototype combines document processing, AI-assisted analysis, and validation workflows to produce findings that can be reviewed by authorized personnel.

### Key Features

- 📄 **Document Upload:** Submit supported documents for analysis.
- 🔍 **Text Extraction:** Extract text from supported PDF documents.
- 🤖 **AI-Assisted Analysis:** Use Groq-powered language model analysis to review extracted content.
- ✅ **Preliminary Validation:** Identify potential issues in the extracted information.
- 📊 **Review Dashboard:** Present document analysis results in a user-friendly interface.
- 🧾 **Explainable Findings:** Display analysis results to support further review.
- 🔐 **Secure Configuration:** Keep API credentials in backend environment variables.

*Features such as official issuing-authority authentication and comprehensive regulatory verification require additional integrations and testing.*

## ⚙️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | React.js, Vite, CSS |
| Backend | Python, FastAPI |
| AI Integration | Groq API |
| Document Processing | PDF text extraction and document-processing libraries |
| API Testing | FastAPI Swagger UI |
| Version Control | Git and GitHub |

## 🏗️ System Architecture

```text
        User / Reviewer
               |
               v
       React.js Frontend
               |
               v
         FastAPI Backend
               |
               v
      PDF Text Extraction
               |
               v
       Groq AI Analysis
               |
               v
    Preliminary Validation
               |
               v
      Results Dashboard
```

## 🔄 Workflow

1. The reviewer uploads a supported document.
2. The frontend sends the document to the FastAPI backend.
3. The backend extracts available text.
4. The extracted content is analyzed using the configured AI service.
5. The system returns analysis results and preliminary findings.
6. The reviewer examines the output and decides whether further verification is necessary.

## 🚀 Getting Started

### Prerequisites

Install the following:

- [Node.js](https://nodejs.org/)
- [Python](https://www.python.org/)
- [Git](https://git-scm.com/)

A Groq API key is required for AI-powered analysis.

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/DocuSure-AI.git
cd DocuSure-AI
```

Replace `YOUR_USERNAME` with your GitHub username.

### 2. Set up the backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create a `.env` file inside the `backend` folder:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Replace the placeholder with your own key. Never commit this file to GitHub.

Start the backend:

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend API: `http://127.0.0.1:8000`

Interactive API documentation: `http://127.0.0.1:8000/docs`

### 3. Set up the frontend

Open a second terminal in the project root:

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

Keep both the frontend and backend terminals running.

> **Note:** These instructions assume the repository contains `backend/requirements.txt`, `backend/main.py`, and the listed npm scripts. Adjust the commands if your project structure differs.

## 🔒 Security and Responsible AI

- Never expose API keys in frontend code or public repositories.
- Use authorized sources for external verification.
- Treat AI-generated findings as preliminary indicators, not proof of fraud.
- Protect uploaded documents and personal information.
- Keep final approval and regulatory decisions with authorized officials.

## 🧪 Future Enhancements

- Integration with authorized issuing-authority verification services.
- Configurable compliance checklists for different application categories.
- Cross-document consistency checking.
- Enhanced tampering and duplicate-document detection.
- Reviewer audit trails and role-based access control.
- Evaluation using labelled test documents and measured performance metrics.

## 🎯 Expected Impact

DocuSure AI aims to reduce repetitive manual checking, identify potential issues earlier, and improve the traceability of institutional application reviews.

Performance improvements and verification accuracy must be established through testing.

## 👥 Project Information

- **Project:** DocuSure AI
- **Problem Statement:** SIH26261
- **Organization:** All India Council for Technical Education (AICTE)
- **Department:** Regulation Bureau
- **Team Name:** Nexus

## 📚 References

1. [AICTE Approval Process Handbook](https://aicte.gov.in/)
2. [National Institute of Standards and Technology — AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
3. [Digital Personal Data Protection Act, 2023 — India Code](https://www.indiacode.nic.in/)

---

**Built as a student hackathon prototype to explore AI-assisted institutional document verification.**
