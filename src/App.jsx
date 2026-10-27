
import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const NAV_ITEMS = [
  { name: "Overview", icon: "▦" },
  { name: "Documents", icon: "▤" },
  { name: "Compliance Review", icon: "✓" },
  { name: "Review History", icon: "◷" },
];

function normalizeDocument(record, index = 0) {
  const analysis =
    record.analysis ||
    record.result ||
    record.analysis_result ||
    record.ai_analysis ||
    null;

  const name =
    record.filename ||
    record.name ||
    record.file_name ||
    record.original_filename ||
    `Document ${index + 1}`;

  const created = record.created_at || record.uploaded_at || record.created;
  const date = created
    ? new Date(created).toLocaleDateString()
    : record.uploaded || "Saved record";

  const rawStatus = String(record.review_status || record.status || "Pending");

  let status = rawStatus;
  if (/verified|approved|resolved/i.test(rawStatus)) status = "Verified";
  else if (/flag|reject|issue|failed/i.test(rawStatus)) status = "Flagged";
  else if (/pending|review|submitted/i.test(rawStatus)) status = "Pending";

  return {
    id: String(record.id || record.document_id || `DOC-${index + 1}`),
    name,
    size:
      record.size ||
      (record.file_size_bytes
        ? `${(record.file_size_bytes / 1024).toFixed(1)} KB`
        : "—"),
    uploaded: date,
    status,
    analysis,
    savedRecord: record,
  };
}

function App() {
  const [activePage, setActivePage] = useState("Overview");
  const [documents, setDocuments] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [historyMessage, setHistoryMessage] = useState("");

  function showMessage(text, type = "info") {
    setMessage(text);
    setMessageType(type);
  }

  async function loadSavedDocuments() {
    setHistoryLoading(true);
    setHistoryMessage("");

    try {
      const response = await fetch(`${API_URL}/api/documents`);

      if (!response.ok) {
        setHistoryMessage(
          "The backend document-list endpoint is unavailable. Showing documents analyzed in this browser session."
        );
        return;
      }

      const data = await response.json();

      const records = Array.isArray(data)
        ? data
        : Array.isArray(data.documents)
          ? data.documents
          : Array.isArray(data.items)
            ? data.items
            : null;

      if (!records) {
        setHistoryMessage(
          "The document endpoint returned an unrecognized data format. Showing session records."
        );
        return;
      }

      const saved = records.map((record, index) =>
        normalizeDocument(record, index)
      );

      setDocuments((current) => {
        const currentByName = new Map(
          current.map((doc) => [doc.name, doc])
        );

        return saved.map((doc) => {
          const existing = currentByName.get(doc.name);
          return existing && !doc.analysis
            ? { ...doc, analysis: existing.analysis }
            : doc;
        });
      });
    } catch {
      setHistoryMessage(
        "Could not load saved records from FastAPI. Session documents remain available."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkApi() {
      try {
        const response = await fetch(`${API_URL}/api/health`);
        if (!cancelled) setApiConnected(response.ok);
      } catch {
        if (!cancelled) setApiConnected(false);
      }
    }

    checkApi();
    loadSavedDocuments();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(
    () => [
      {
        label: "Total Documents",
        value: documents.length,
        icon: "▤",
        color: "blue",
      },
      {
        label: "Pending Review",
        value: documents.filter((doc) => doc.status === "Pending").length,
        icon: "◷",
        color: "orange",
      },
      {
        label: "Verified",
        value: documents.filter((doc) => doc.status === "Verified").length,
        icon: "✓",
        color: "green",
      },
      {
        label: "Flagged",
        value: documents.filter((doc) => doc.status === "Flagged").length,
        icon: "!",
        color: "red",
      },
    ],
    [documents]
  );

  function handleFileChange(event) {
    const file = event.target.files?.[0];

    setMessage("");
    setSelectedFile(null);

    if (!file) return;

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      showMessage("Please select a PDF file.", "error");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showMessage("File size must be 10 MB or less.", "error");
      event.target.value = "";
      return;
    }

    if (file.size === 0) {
      showMessage("The selected file is empty.", "error");
      event.target.value = "";
      return;
    }

    setSelectedFile(file);
    showMessage("PDF selected. Ready for analysis.", "success");
  }

  async function handleUpload() {
    if (!selectedFile) {
      showMessage("Choose a PDF file before uploading.", "error");
      return;
    }

    if (documents.some((doc) => doc.name === selectedFile.name)) {
      showMessage(
        "A document with this filename is already listed. Rename it or select a different PDF.",
        "error"
      );
      return;
    }

    setLoading(true);
    showMessage(
      "Uploading PDF, extracting text, and running AI analysis...",
      "info"
    );

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch(`${API_URL}/api/analyze`, {
        method: "POST",
        body: formData,
      });

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error("The backend returned an invalid response.");
      }

      if (!response.ok) {
        throw new Error(
          result.detail || `Analysis failed (${response.status}).`
        );
      }

      const findings = Array.isArray(result.findings)
        ? result.findings
        : [];

      const ai = result.ai_analysis;

      const allFindings = [
        ...findings,
        ...(Array.isArray(ai?.potential_issues)
          ? ai.potential_issues
          : []),
      ];

      const manualReview =
        result.status === "Manual Review Required" ||
        /fictional|test data only|not an official document|placeholder|not government-issued/i.test(
          result.text_preview || ""
        );

      const flagged =
        manualReview ||
        result.status === "Review Required" ||
        result.status === "Flagged" ||
        allFindings.some((finding) =>
          /expired|missing|not detected|mismatch|inconsisten|placeholder|manual review|could not verify|not found/i.test(
            String(finding)
          )
        );

      const newDocument = {
        id: `DOC-${Date.now().toString().slice(-7)}`,
        name: result.filename || selectedFile.name,
        size: `${(selectedFile.size / 1024).toFixed(1)} KB`,
        uploaded: new Date().toLocaleDateString(),
        status: flagged ? "Flagged" : "Pending",
        analysis: result,
      };

      setDocuments((current) => [newDocument, ...current]);
      setSelectedDocument(newDocument);
      setSelectedFile(null);
      setActivePage("Compliance Review");

      const input = document.getElementById("pdf-input");
      if (input) input.value = "";

      setApiConnected(true);

      showMessage(
        result.ai_status === "success"
          ? "PDF analyzed successfully with AI."
          : "PDF analyzed. AI was unavailable or not configured; basic checks are shown.",
        result.ai_status === "success" ? "success" : "info"
      );

      loadSavedDocuments();
    } catch (error) {
      const detail =
        error.message === "Failed to fetch"
          ? "Cannot connect to FastAPI. Make sure the backend is running on port 8000."
          : error.message || "Unexpected error during analysis.";

      showMessage(detail, "error");
      setApiConnected(false);
    } finally {
      setLoading(false);
    }
  }

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch = `${doc.name} ${doc.id} ${doc.status}`
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "All" || doc.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  function viewDocument(doc, page = "Compliance Review") {
    setSelectedDocument(doc);
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeAnalysis() {
    setSelectedDocument(null);
  }

  const analysis = selectedDocument?.analysis;
  const ai = analysis?.ai_analysis;

  function renderAnalysisPanel() {
    if (!selectedDocument || !analysis) {
      return (
        <div className="empty-state">
          <div className="empty-icon">✓</div>
          <strong>No analysis selected</strong>
          <p>Choose a document from Documents to review its analysis.</p>
          <button
            className="primary-button"
            onClick={() => setActivePage("Documents")}
          >
            Open Documents
          </button>
        </div>
      );
    }

    return (
      <div className="table-card analysis-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">DOCUMENT INTELLIGENCE</p>
            <h2>Analysis results</h2>
            <p>{selectedDocument.name}</p>
          </div>
          <button className="primary-button" onClick={closeAnalysis}>
            Close
          </button>
        </div>

        <div className="analysis-summary-grid">
          <div className="stat-card">
            <p>Pages</p>
            <h2>{analysis.pages ?? "—"}</h2>
          </div>

          <div className="stat-card">
            <p>Characters extracted</p>
            <h2>{analysis.characters_extracted ?? "—"}</h2>
          </div>

          <div className="stat-card">
            <p>Review status</p>
            <h2 className="analysis-status">
              {analysis.status ||
                selectedDocument.status ||
                "Review Required"}
            </h2>
          </div>
        </div>

        {ai ? (
          <section className="ai-results">
            <h3>AI-assisted analysis</h3>

            <p>
              <strong>Document type:</strong>{" "}
              {ai.document_type || "Not identified"}
            </p>

            <p>
              <strong>Summary:</strong>{" "}
              {ai.summary || "No summary returned."}
            </p>

            <h4>Key information extracted</h4>

            {Object.keys(ai.key_fields || {}).length > 0 ? (
              <div className="key-fields">
                {Object.entries(ai.key_fields).map(([key, value]) => (
                  <div className="key-field" key={key}>
                    <strong>{key.replace(/_/g, " ")}</strong>
                    <span>
                      {typeof value === "string"
                        ? value
                        : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p>No key fields were identified.</p>
            )}

            <h4>Potential issues</h4>

            {ai.potential_issues?.length > 0 ? (
              <ul>
                {ai.potential_issues.map((issue, index) => (
                  <li key={index}>
                    {typeof issue === "string"
                      ? issue
                      : JSON.stringify(issue)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No potential issues were returned by AI.</p>
            )}

            <h4>Recommended actions</h4>

            {ai.recommended_actions?.length > 0 ? (
              <ul>
                {ai.recommended_actions.map((action, index) => (
                  <li key={index}>{action}</li>
                ))}
              </ul>
            ) : (
              <p>Review the document manually.</p>
            )}

            {ai.review_recommendation && (
              <p>
                <strong>Review recommendation:</strong>{" "}
                {ai.review_recommendation}
              </p>
            )}

            <p className="ai-connection">
              AI connection:{" "}
              <strong>{analysis.ai_status || "unknown"}</strong>
            </p>
          </section>
        ) : (
          <section className="ai-results">
            <h3>AI analysis unavailable</h3>
            <p>
              Basic PDF checks are available. Check the backend configuration
              and Groq API key to enable AI results.
            </p>
          </section>
        )}

        <section className="review-findings">
          <h3>Review findings</h3>

          {analysis.findings?.length > 0 ? (
            <ul>
              {analysis.findings.map((finding, index) => (
                <li key={index}>
                  {typeof finding === "string"
                    ? finding
                    : JSON.stringify(finding)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No preliminary issues were returned.</p>
          )}
        </section>

        <p className="subtitle">
          {analysis.note ||
            "AI results are preliminary and require authorized human review."}
        </p>

        <details className="extracted-text">
          <summary>View extracted text preview</summary>
          <pre className="text-preview">
            {analysis.text_preview || "No text preview available."}
          </pre>
        </details>
      </div>
    );
  }

  function renderDocumentTable() {
    return (
      <>
        <div className="section-heading table-heading">
          <div>
            <h2>Document register</h2>
            <p>
              Documents returned by the backend and analyzed in this session.
            </p>
          </div>

          <input
            className="search-input"
            placeholder="Search documents..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>DOCUMENT</th>
                  <th>DOCUMENT ID</th>
                  <th>DATE ADDED</th>
                  <th>SIZE</th>
                  <th>STATUS</th>
                  <th>DETAILS</th>
                </tr>
              </thead>

              <tbody>
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <div className="document-name">
                        <span>PDF</span>
                        {doc.name}
                      </div>
                    </td>
                    <td>{doc.id}</td>
                    <td>{doc.uploaded}</td>
                    <td>{doc.size}</td>
                    <td>
                      <span className="table-status">{doc.status}</span>
                    </td>
                    <td>
                      <button
                        className="primary-button"
                        onClick={() => viewDocument(doc)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredDocuments.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">▤</div>
              <strong>No documents found</strong>
              <p>Upload a PDF or change your search/filter.</p>
              {historyLoading && <p>Loading saved records…</p>}
            </div>
          )}
        </div>
      </>
    );
  }

  function renderOverview() {
    return (
      <>
        <div className="notice">
          <span className="notice-icon">i</span>
          <div>
            <strong>Welcome to DocuSure AI</strong>
            <p>
              Upload a PDF for text extraction, AI-assisted analysis,
              preliminary issue detection, and recommended review actions.
              Final decisions require authorized human review.
            </p>
          </div>
        </div>

        <div className="stats-grid">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <div className={`stat-icon ${stat.color}`}>{stat.icon}</div>
              <p>{stat.label}</p>
              <h2>{stat.value}</h2>
              <span className="stat-foot">
                Loaded records and current session
              </span>
            </div>
          ))}
        </div>

        <div className="section-heading">
          <div>
            <h2>Document submission</h2>
            <p>Upload a PDF to begin preliminary document scrutiny.</p>
          </div>
        </div>

        <div className="upload-card">
          <div className="upload-symbol">▤</div>
          <h3>Upload supporting document</h3>
          <p>PDF files only · Maximum file size 10 MB</p>

          <input
            id="pdf-input"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            disabled={loading}
          />

          {selectedFile && (
            <div className="selected-file">
              <span>▤</span>
              <div>
                <strong>{selectedFile.name}</strong>
                <small>
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </small>
              </div>
            </div>
          )}

          {message && (
            <p
              className={`message ${messageType}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          )}

          <button
            className="primary-button"
            onClick={handleUpload}
            disabled={loading}
          >
            {loading ? "Analyzing PDF..." : "Submit for AI-assisted review"}
          </button>
        </div>

        {selectedDocument && analysis && renderAnalysisPanel()}

        <div className="section-heading table-heading">
          <div>
            <h2>Recent documents</h2>
            <p>Open a document to inspect its preliminary findings.</p>
          </div>

          <button
            className="primary-button"
            onClick={() => setActivePage("Documents")}
          >
            View document register
          </button>
        </div>

        {renderDocumentTable()}
      </>
    );
  }

  function renderComplianceReview() {
    const reviewable = documents.filter((doc) => doc.analysis);

    return (
      <>
        <div className="notice">
          <span className="notice-icon">✓</span>
          <div>
            <strong>Compliance Review</strong>
            <p>
              Inspect preliminary validation findings and AI recommendations.
              AI flags are not proof of fraud or an official compliance
              decision.
            </p>
          </div>
        </div>

        {selectedDocument?.analysis && renderAnalysisPanel()}

        <div className="section-heading table-heading">
          <div>
            <h2>Documents requiring review</h2>
            <p>
              Select a document to inspect its analysis and recommendations.
            </p>
          </div>
        </div>

        {reviewable.length === 0 ? (
          <div className="table-card empty-state">
            <div className="empty-icon">✓</div>
            <strong>No review results yet</strong>
            <p>Upload a PDF from Overview to run document analysis.</p>
            <button
              className="primary-button"
              onClick={() => setActivePage("Overview")}
            >
              Go to document submission
            </button>
          </div>
        ) : (
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>DOCUMENT</th>
                    <th>STATUS</th>
                    <th>AI STATUS</th>
                    <th>REVIEW</th>
                  </tr>
                </thead>

                <tbody>
                  {reviewable.map((doc) => (
                    <tr key={doc.id}>
                      <td>{doc.name}</td>
                      <td>
                        <span className="table-status">{doc.status}</span>
                      </td>
                      <td>{doc.analysis?.ai_status || "Unknown"}</td>
                      <td>
                        <button
                          className="primary-button"
                          onClick={() => viewDocument(doc)}
                        >
                          Review findings
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>
    );
  }

  function renderReviewHistory() {
    return (
      <>
        <div className="notice">
          <span className="notice-icon">◷</span>
          <div>
            <strong>Review History</strong>
            <p>
              Review records returned by the backend are shown here alongside
              documents analyzed during the current browser session.
            </p>
          </div>
        </div>

        {historyMessage && (
          <p className="message info">{historyMessage}</p>
        )}

        <div className="section-heading table-heading">
          <div>
            <h2>Previous document reviews</h2>
            <p>
              {historyLoading
                ? "Refreshing saved records…"
                : `${documents.length} record(s) currently available.`}
            </p>
          </div>

          <button
            className="primary-button"
            onClick={loadSavedDocuments}
            disabled={historyLoading}
          >
            {historyLoading ? "Refreshing..." : "Refresh history"}
          </button>
        </div>

        {renderDocumentTable()}
      </>
    );
  }

  const pageDescriptions = {
    Overview: "Document scrutiny and institutional verification workspace.",
    Documents: "Browse uploaded documents and inspect extracted details.",
    "Compliance Review":
      "Review preliminary findings, AI analysis, and recommended actions.",
    "Review History": "Browse previous review records available from the backend.",
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark government-symbol" aria-label="Decorative chakra symbol">
            ☸
          </div>
          <div>
            <h2>DocuSure AI</h2>
            <p>Institutional Verification Portal</p>
          </div>
        </div>

        <p className="nav-heading">PORTAL NAVIGATION</p>

        <nav aria-label="Portal navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.name}
              type="button"
              className={`nav-item ${
                activePage === item.name ? "active" : ""
              }`}
              onClick={() => {
                setActivePage(item.name);
                setMessage("");

                if (
                  item.name === "Review History" ||
                  item.name === "Documents"
                ) {
                  loadSavedDocuments();
                }
              }}
            >
              <span>{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="security-icon">✓</div>
          <strong>Document security</strong>
          <p>AI-assisted review with human oversight.</p>
          <span className="local-badge">PROTOTYPE PORTAL</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="government-header">
            <div className="national-mark" aria-label="Decorative chakra symbol">
              ☸
            </div>

            <div className="government-heading">
              <strong>INSTITUTIONAL APPLICATION VERIFICATION</strong>
              <span>
                AI-assisted document scrutiny and compliance review
              </span>
            </div>

            <div className="portal-language">ENGLISH</div>
          </div>

          <div className="tricolour-strip" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="breadcrumb">
            Home / <strong>{activePage}</strong>
          </div>

          <div className="reviewer">
            <div
              className="avatar"
              title={apiConnected ? "FastAPI connected" : "FastAPI not detected"}
            >
              {apiConnected ? "✓" : "R"}
            </div>
            <div>
              <strong>Reviewer Workspace</strong>
              <small>
                {apiConnected
                  ? "Backend connected"
                  : "Backend connection unavailable"}
              </small>
            </div>
          </div>
        </header>

        <section className="page-content">
          <div className="welcome-row">
            <div>
              <p className="eyebrow">DOCUMENT REVIEW SYSTEM</p>
              <h1>
                {activePage === "Overview"
                  ? "Institutional Review Dashboard"
                  : activePage}
              </h1>
              <p className="subtitle">
                {pageDescriptions[activePage]}
              </p>
            </div>

            <span className="status-pill">
              <span />
              {apiConnected ? "System connected" : "Check backend connection"}
            </span>
          </div>

          {activePage === "Overview" && renderOverview()}
          {activePage === "Documents" && renderDocumentTable()}
          {activePage === "Compliance Review" && renderComplianceReview()}
          {activePage === "Review History" && renderReviewHistory()}

          <footer>
            DocuSure AI · Hackathon prototype · Not an official government
            website · Final decisions require authorized human review
          </footer>
        </section>
      </main>
    </div>
  );
}

export default App;
