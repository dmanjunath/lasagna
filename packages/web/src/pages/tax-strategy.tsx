import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, Trash2, RefreshCw, Upload, X, HelpCircle, ShieldCheck, FolderOpen, ArrowRight } from "lucide-react";
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import type { TaxDocument, TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useInsights } from "../hooks/useInsights.js";
import { usePageContext } from "../lib/page-context.js";
import { useChatStore } from "../lib/chat-store.js";
import { LegalDisclaimer } from "../components/common/legal-disclaimer.js";
import {
  Page,
  PageHeader,
  Section,
  Card,
  Button,
  Pill,
  Eyebrow,
  DataTable,
  EmptyState,
  StatStrip,
  Lede,
} from "../components/ds";
import type { DataTableColumn } from "../components/ds/DataTable";

// ─── helpers ────────────────────────────────────────────────────────────────

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  head_of_household: "Head of Household",
};

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

const FILING_YEAR = new Date().getFullYear() - 1;

/** Extract dollar amount from impact strings like "Save $2,400/yr" or "Earn $3,400 free money" */
function parseDollarAmount(s: string): number {
  const match = s.match(/\$[\d,]+(?:\.\d+)?/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/[$,]/g, "")) || 0;
}

/** Friendly labels for common tax form types */
const FORM_LABELS: Record<string, string> = {
  "1040": "Form 1040 — Individual Tax Return",
  "1040-sr": "Form 1040-SR — Senior Tax Return",
  "w-2": "W-2 — Wage & Tax Statement",
  "w2": "W-2 — Wage & Tax Statement",
  "1099-misc": "1099-MISC — Miscellaneous Income",
  "1099-nec": "1099-NEC — Non-Employee Compensation",
  "1099-int": "1099-INT — Interest Income",
  "1099-div": "1099-DIV — Dividend Income",
  "1099-b": "1099-B — Proceeds from Broker",
  "1099-r": "1099-R — Retirement Distributions",
  "1099-g": "1099-G — Government Payments",
  "1099-k": "1099-K — Payment Card Transactions",
  "1099-sa": "1099-SA — HSA Distributions",
  "1098": "1098 — Mortgage Interest",
  "1098-t": "1098-T — Tuition Statement",
  "1098-e": "1098-E — Student Loan Interest",
  "1120": "Form 1120 — Corporate Tax Return",
  "1120s": "Form 1120S — S-Corp Tax Return",
  "1120-s": "Form 1120S — S-Corp Tax Return",
  "1065": "Form 1065 — Partnership Return",
  "k-1": "Schedule K-1 — Partner/Shareholder Income",
  "schedule k-1": "Schedule K-1 — Partner/Shareholder Income",
  "5498": "5498 — IRA Contribution Info",
};

function extractFormType(fields: Record<string, unknown>): string | null {
  if (!fields || typeof fields !== "object") return null;
  for (const k of ["document_type", "form_type", "documentType", "formType", "type", "form"]) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof fields.fields === "object" && fields.fields !== null) {
    const nested = extractFormType(fields.fields as Record<string, unknown>);
    if (nested) return nested;
  }
  return null;
}

function extractFormTypeFromSummary(summary: string): string | null {
  if (!summary) return null;
  const patterns = [
    /\b(Form\s+\d{4}[A-Z]?(?:-[A-Z]+)?)\b/i,
    /\b(W-?2)\b/i,
    /\b(\d{4}[A-Z]?(?:-[A-Z]+)?)\s+(?:for|showing|from|—|tax)/i,
    /\b(Schedule\s+K-1)\b/i,
    /\b(1099-[A-Z]+)\b/i,
    /\b(1098-?[A-Z]?)\b/i,
  ];
  for (const re of patterns) {
    const m = summary.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function getDocLabel(doc: { llmFields?: Record<string, unknown> | null; llmSummary: string; fileName: string }): { label: string; formType: string | null } {
  const rawType = extractFormType((doc.llmFields ?? {}) as Record<string, unknown>);
  if (rawType) {
    const key = rawType.toLowerCase().replace(/\s+/g, "").replace("form", "");
    const lookupKey = rawType.toLowerCase().trim();
    const friendly = FORM_LABELS[lookupKey] || FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: rawType.toUpperCase() };
    return { label: rawType, formType: rawType.toUpperCase() };
  }

  const summaryType = extractFormTypeFromSummary(doc.llmSummary);
  if (summaryType) {
    const key = summaryType.toLowerCase().trim();
    const friendly = FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: summaryType.toUpperCase() };
    return { label: summaryType, formType: summaryType.toUpperCase() };
  }

  if (doc.llmSummary) {
    const firstSentence = doc.llmSummary.split(/[.!]\s/)[0];
    if (firstSentence && firstSentence.length < 80) {
      return { label: firstSentence, formType: null };
    }
  }

  const nameNoExt = doc.fileName.replace(/\.[^.]+$/, "");
  return { label: nameNoExt, formType: null };
}

function urgencyPill(color?: string) {
  // map insight impactColor to a Pill tone
  if (color === 'red') return { tone: 'sauce' as const, label: 'High priority' };
  if (color === 'green') return { tone: 'basil' as const, label: 'Opportunity' };
  return { tone: 'cheese' as const, label: 'Worth a look' };
}

// ─── types ───────────────────────────────────────────────────────────────────

interface Profile {
  filingStatus: string | null;
  annualIncome: number | null;
  stateOfResidence: string | null;
}

// ─── component ───────────────────────────────────────────────────────────────

export function TaxStrategy() {
  const [documents, setDocuments] = useState<TaxDocumentSummary[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [insightStatus, setInsightStatus] = useState<"idle" | "generating" | "done">("idle");
  const [selectedDoc, setSelectedDoc] = useState<TaxDocument | null>(null);
  const [docLoading, setDocLoading] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const safetyRef = useRef<HTMLDivElement>(null);

  const { insights, isLoading: insightsLoading, reload, refresh, dismiss } = useInsights("tax");
  const { setPageContext } = usePageContext();
  const { openChat } = useChatStore();

  // Close safety popover on outside click
  useEffect(() => {
    if (!showSafety) return;
    const handler = (e: MouseEvent) => {
      if (safetyRef.current && !safetyRef.current.contains(e.target as Node)) {
        setShowSafety(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSafety]);

  useEffect(() => {
    loadDocuments();
    api
      .getFinancialProfile()
      .then(({ financialProfile }) => {
        if (financialProfile) {
          setProfile({
            filingStatus: financialProfile.filingStatus ?? null,
            annualIncome: financialProfile.annualIncome ?? null,
            stateOfResidence: financialProfile.stateOfResidence ?? null,
          });
        }
      })
      .catch(() => {});
  }, []);

  const loadDocuments = async () => {
    try {
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);
    } catch {
      setDocuments([]);
    }
  };

  const handleInputSuccess = useCallback(
    (doc: TaxInputResult) => {
      setDocuments((prev) => [
        {
          id: doc.id,
          fileName: doc.fileName,
          llmFields: doc.llmFields,
          llmSummary: doc.llmSummary,
          taxYear: doc.taxYear,
          createdAt: doc.createdAt,
        },
        ...prev,
      ]);
      setInsightStatus("generating");
      setTimeout(() => {
        reload()
          .then(() => setInsightStatus("done"))
          .catch(() => setInsightStatus("idle"));
      }, 5000);
    },
    [reload]
  );

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) setSelectedDoc(null);
      setInsightStatus("generating");
      setTimeout(() => {
        reload()
          .then(() => setInsightStatus("done"))
          .catch(() => setInsightStatus("idle"));
      }, 5000);
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, [selectedDoc, reload]);

  const handleSelectDocument = useCallback(async (id: string) => {
    if (selectedDoc?.id === id) {
      setSelectedDoc(null);
      return;
    }
    setDocLoading(id);
    try {
      const { document } = await api.getTaxDocument(id);
      setSelectedDoc(document);
    } catch (err) {
      console.error("Failed to load document:", err);
    } finally {
      setDocLoading(null);
    }
  }, [selectedDoc]);

  const handleRefreshInsights = useCallback(async () => {
    setRefreshingInsights(true);
    try {
      await refresh();
    } finally {
      setRefreshingInsights(false);
    }
  }, [refresh]);

  const filingLabel = profile?.filingStatus
    ? FILING_LABELS[profile.filingStatus] ?? profile.filingStatus
    : null;

  const estimatedSavings = useMemo(() => {
    if (documents.length === 0 || insights.length === 0) return null;
    let total = 0;
    for (const ins of insights) {
      const amt = ins.impact ? parseDollarAmount(ins.impact) : 0;
      if (amt > 0) total += amt;
    }
    return total > 0 ? total : null;
  }, [insights, documents.length]);

  useEffect(() => {
    if (profile) {
      setPageContext({
        pageId: "tax",
        pageTitle: "Tax Strategy",
        description: "Tax optimization suggestions and uploaded document analysis.",
      });
    }
  }, [profile, setPageContext]);

  // Document table columns
  const docCols: DataTableColumn<TaxDocumentSummary>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (doc) => {
        const { label } = getDocLabel(doc);
        const isSelected = selectedDoc?.id === doc.id;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <FileText
              size={14}
              style={{ color: isSelected ? 'var(--lf-cheese)' : 'var(--lf-muted)', flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, color: 'var(--lf-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--lf-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {doc.fileName}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      cell: (doc) => {
        const { formType } = getDocLabel(doc);
        return formType
          ? <Pill tone="cream">{formType}</Pill>
          : <span className="ds-caption">—</span>;
      },
    },
    {
      key: 'year',
      header: 'Year',
      muted: true,
      cell: (doc) => doc.taxYear ? <span className="ds-num">{doc.taxYear}</span> : '—',
    },
    {
      key: 'uploaded',
      header: 'Uploaded',
      muted: true,
      cell: (doc) => doc.createdAt
        ? <span className="ds-num">{new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        : '—',
    },
    {
      key: 'actions',
      header: '',
      cell: (doc) => {
        const isLoading = docLoading === doc.id;
        const isConfirming = deleteConfirmId === doc.id;
        return (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            {isLoading && <RefreshCw size={12} style={{ color: 'var(--lf-muted)', animation: 'spin 1s linear infinite' }} />}
            {import.meta.env.VITE_DEMO_MODE !== "true" && (
              isConfirming ? (
                <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id); setDeleteConfirmId(null); }}
                    className="ds-btn ds-btn--primary ds-btn--sm"
                  >
                    Delete
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                    className="ds-btn ds-btn--ghost ds-btn--sm"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(doc.id); }}
                  style={{
                    background: 'transparent', border: '1px solid var(--lf-rule)', borderRadius: 6,
                    cursor: 'pointer', color: 'var(--lf-muted)', padding: 6, lineHeight: 0,
                  }}
                  aria-label="Delete document"
                >
                  <Trash2 size={13} />
                </button>
              )
            )}
          </div>
        );
      },
    },
  ];

  const uploadBtn = import.meta.env.VITE_DEMO_MODE !== "true" ? (
    <Button
      variant="primary"
      icon={<Upload size={14} />}
      onClick={() => {
        const el = document.getElementById("tax-documents-section");
        el?.scrollIntoView({ behavior: "smooth" });
      }}
    >
      Upload documents
    </Button>
  ) : null;

  return (
    <Page>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .tax-strip { margin: 32px 0 48px; }
        .tax-feed { list-style: none; margin: 0; padding: 0; }
        .tax-feed li {
          padding: 22px 0;
          border-top: 1px solid var(--lf-rule);
        }
        .tax-feed li:last-child { padding-bottom: 0; }
        .tax-feed__row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: start;
        }
        .tax-feed__main { min-width: 0; }
        .tax-feed__head {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
          margin-bottom: 8px;
        }
        .tax-feed__title {
          font-family: 'Instrument Serif', Georgia, serif;
          font-weight: 500;
          font-size: clamp(20px, 2.2vw, 26px);
          line-height: 1.15;
          color: var(--lf-ink);
          margin: 0;
          letter-spacing: -0.01em;
        }
        .tax-feed__body {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.55;
          color: var(--lf-ink-soft);
          margin: 0;
          max-width: 60ch;
        }
        .tax-feed__impact {
          margin-top: 8px;
          display: inline-block;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
        }
        .tax-feed__actions {
          display: flex; gap: 4px;
          align-items: flex-start; padding-top: 4px;
        }
        .tax-feed__open {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--lf-muted);
          background: transparent; border: none; cursor: pointer;
          padding: 4px 6px;
          transition: color 0.15s, transform 0.15s;
        }
        .tax-feed__open:hover { color: var(--lf-sauce); transform: translateX(2px); }
        .tax-feed__dismiss {
          display: flex; align-items: center; justify-content: center;
          width: 28px; height: 28px; border-radius: 6px;
          border: none; background: transparent;
          color: var(--lf-muted); cursor: pointer;
        }
        .tax-feed__dismiss:hover { background: var(--lf-cream); color: var(--lf-ink); }
        .tax-doc-layout { display: grid; grid-template-columns: 1fr; gap: 0; }
        @media (min-width: 900px) {
          .tax-doc-layout.is-split { grid-template-columns: 1fr 1fr; }
        }
        .tax-doc-detail-wrap { border-top: 1px solid var(--lf-rule); }
        @media (min-width: 900px) {
          .tax-doc-layout.is-split .tax-doc-detail-wrap {
            border-top: none;
            border-left: 1px solid var(--lf-rule);
          }
        }
      `}</style>

      <PageHeader
        eyebrow={`${FILING_YEAR} filing year`}
        title="Tax"
        actions={uploadBtn}
      />

      {/* Editorial lede */}
      <div style={{ marginBottom: 8 }}>
        <Lede>
          We see{' '}
          <Lede.Num>{documents.length}</Lede.Num>
          {' '}tax document{documents.length === 1 ? '' : 's'} and{' '}
          <Lede.Num tone={insights.length > 0 ? 'pos' : 'default'}>{insights.length}</Lede.Num>
          {' '}open opportunit{insights.length === 1 ? 'y' : 'ies'}
          {estimatedSavings && (
            <>
              {' '}worth roughly{' '}
              <Lede.Num highlight>{formatMoney(estimatedSavings)}/yr</Lede.Num>
            </>
          )}
          .
        </Lede>
      </div>

      {/* Stat strip */}
      <StatStrip
        className="tax-strip"
        items={[
          {
            label: 'Estimated savings',
            value: <span className="ds-num">{insightsLoading ? '…' : estimatedSavings ? formatMoney(estimatedSavings) : '—'}</span>,
            sub: insightsLoading ? 'calculating' : estimatedSavings ? '/yr from insights' : 'upload documents',
            tone: estimatedSavings ? 'pos' : 'default',
          },
          {
            label: 'Filing status',
            value: filingLabel ?? '—',
            sub: profile?.stateOfResidence ?? undefined,
          },
          {
            label: 'Documents',
            value: <span className="ds-num">{documents.length}</span>,
            sub: documents.length === 1 ? 'uploaded' : 'uploaded',
          },
          {
            label: 'Open actions',
            value: <span className="ds-num">{insightsLoading ? '…' : insights.length}</span>,
            sub: insights.length === 1 ? 'tax action' : 'tax actions',
          },
        ]}
      />

      {/* Tax inputs */}
      {import.meta.env.VITE_DEMO_MODE !== "true" && (
        <Section
          title="Tax inputs"
          eyebrow="Upload or describe"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {insightStatus === "generating" && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.16em',
                  textTransform: 'uppercase', color: "var(--lf-cheese)",
                }}>
                  <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} />
                  Updating insights…
                </span>
              )}
              {insightStatus === "done" && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.16em',
                  textTransform: 'uppercase', color: "var(--lf-basil)",
                }}>
                  Actions updated ✓
                </span>
              )}
              <div style={{ position: "relative" }} ref={safetyRef}>
                <button
                  onClick={() => setShowSafety((p) => !p)}
                  style={{
                    background: "transparent", border: "1px solid var(--lf-rule)",
                    borderRadius: 6, cursor: "pointer", padding: 6,
                    color: "var(--lf-muted)", display: "flex", alignItems: "center", lineHeight: 0,
                  }}
                  aria-label="Privacy & safety information"
                >
                  <HelpCircle size={13} />
                </button>
                {showSafety && (
                  <div
                    style={{
                      position: "absolute", right: 0, top: 32, zIndex: 50, width: 280,
                      borderRadius: 12, border: "1px solid var(--lf-rule)",
                      background: "var(--lf-paper)", boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      padding: 16, textAlign: 'left',
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <ShieldCheck size={14} style={{ color: "var(--lf-basil)", flexShrink: 0 }} />
                      <span className="ds-h3" style={{ fontSize: 13 }}>Privacy & security</span>
                      <button
                        onClick={() => setShowSafety(false)}
                        style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", padding: 0, color: "var(--lf-muted)" }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[
                        "Open-weight models with zero data retention — documents never used for training.",
                        "Documents sent over HTTPS, used only for field extraction.",
                        "Only extracted tax fields are stored — not the original file.",
                        "Prefer not to upload? Use the text option to describe your situation.",
                      ].map((item) => (
                        <div key={item} className="ds-body ds-body--sm" style={{ display: "flex", gap: 6 }}>
                          <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--lf-muted)", flexShrink: 0, marginTop: 7, opacity: 0.5 }} />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          }
        >
          <div id="tax-documents-section">
            <Card>
              <TaxInputPanel onSuccess={handleInputSuccess} />
            </Card>
          </div>
        </Section>
      )}

      {/* Recommended actions — editorial article list */}
      {!insightsLoading && insights.length > 0 && (
        <Section
          title="Recommended actions"
          eyebrow={estimatedSavings ? `${formatMoney(estimatedSavings)}/yr potential` : `${insights.length} action${insights.length === 1 ? '' : 's'}`}
          actions={
            <Button variant="link" size="sm" onClick={handleRefreshInsights} disabled={refreshingInsights}>
              {refreshingInsights ? "↻ Refreshing…" : "↻ Refresh"}
            </Button>
          }
        >
          <ul className="tax-feed">
            {insights.map((ins) => {
              const pill = urgencyPill(ins.impactColor as string | undefined);
              const impactTone = ins.impactColor === 'green' ? 'var(--lf-basil)'
                : ins.impactColor === 'red' ? 'var(--lf-sauce)'
                : 'var(--lf-cheese)';
              return (
                <li key={ins.id}>
                  <div className="tax-feed__row">
                    <div className="tax-feed__main">
                      <div className="tax-feed__head">
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                        <h3 className="tax-feed__title">{ins.title}</h3>
                      </div>
                      {ins.description && <p className="tax-feed__body">{ins.description}</p>}
                      {ins.impact && (
                        <span className="tax-feed__impact" style={{ color: impactTone }}>
                          {ins.impact}
                        </span>
                      )}
                    </div>
                    <div className="tax-feed__actions">
                      <button
                        type="button"
                        className="tax-feed__dismiss"
                        onClick={() => dismiss(ins.id)}
                        title="Dismiss"
                        aria-label="Dismiss"
                      >
                        <X size={14} />
                      </button>
                      <button
                        type="button"
                        className="tax-feed__open"
                        onClick={() => openChat(ins.chatPrompt ?? ins.title)}
                        aria-label="Open"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 24 }}>
            <LegalDisclaimer variant="insights" />
          </div>
        </Section>
      )}

      {/* Documents */}
      <Section
        title="Documents"
        eyebrow={documents.length > 0 ? `${documents.length} uploaded` : 'None yet'}
      >
        {documents.length === 0 ? (
          <EmptyState
            icon={<FolderOpen size={40} />}
            title="No documents uploaded yet"
            body="Upload W-2s, 1099s, or any tax form. We extract the fields, surface deductions, and never store the original file."
          />
        ) : (
          <Card flush>
            <div className={`tax-doc-layout ${selectedDoc ? 'is-split' : ''}`}>
              <div>
                <DataTable
                  columns={docCols}
                  rows={documents}
                  rowKey={(d) => d.id}
                  hover
                  onRowClick={(d) => handleSelectDocument(d.id)}
                />
              </div>

              <AnimatePresence>
                {selectedDoc && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="tax-doc-detail-wrap"
                  >
                    <DocumentDetail doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>
        )}
      </Section>
    </Page>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (value > 100 && value < 100_000_000) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);
    }
    return value.toLocaleString();
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(v)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function isNestedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DocumentDetail({ doc, onClose }: { doc: TaxDocument; onClose: () => void }) {
  const fields = doc.llmFields as Record<string, unknown>;
  const fieldEntries = Object.entries(fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  const docType = fields.document_type || fields.form_type || null;
  const taxYear = fields.tax_year ?? doc.taxYear ?? null;
  const metaKeys = new Set(["document_type", "form_type", "tax_year"]);
  const flatFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && !isNestedObject(v)
  );
  const nestedFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && isNestedObject(v)
  );

  return (
    <div style={{ padding: 16, overflowY: 'auto', maxHeight: 480 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {docType && <Pill tone="ink">{String(docType)}</Pill>}
          {taxYear && <Pill tone="cream">Tax Year {String(taxYear)}</Pill>}
          <Eyebrow>Extracted fields</Eyebrow>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 2, color: 'var(--lf-muted)', borderRadius: 4,
          }}
          aria-label="Close detail"
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--lf-ink)', marginBottom: 8 }}>
        {doc.fileName}
      </div>

      {doc.llmSummary && (
        <div className="ds-body ds-body--sm" style={{
          color: 'var(--lf-ink-soft)', marginBottom: 14,
          padding: '10px 12px', background: 'var(--lf-cream)', borderRadius: 8,
        }}>
          {doc.llmSummary}
        </div>
      )}

      {flatFields.length > 0 ? (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
          background: 'var(--lf-rule)', borderRadius: 8, overflow: 'hidden',
          border: '1px solid var(--lf-rule)',
        }}>
          {flatFields.map(([key, value]) => (
            <div key={key} style={{
              display: 'flex', flexDirection: 'column', gap: 2,
              padding: '8px 10px', background: 'var(--lf-paper)',
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11, color: 'var(--lf-muted)', letterSpacing: '0.04em',
              }}>
                {formatFieldKey(key)}
              </div>
              <div className={typeof value === 'number' ? 'ds-num' : ''} style={{
                fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)',
                fontFamily: typeof value === 'number' ? "'JetBrains Mono', monospace" : 'inherit',
              }}>
                {formatFieldValue(value)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !nestedFields.length && (
          <div className="ds-caption" style={{ textAlign: 'center', padding: '16px 0' }}>
            No extracted fields available.
          </div>
        )
      )}

      {nestedFields.map(([key, value]) => {
        const obj = value as Record<string, unknown>;
        const entries = Object.entries(obj).filter(
          ([, v]) => v !== null && v !== undefined && v !== ""
        );
        if (!entries.length) return null;
        return (
          <div key={key} style={{ marginTop: 14 }}>
            <Eyebrow>{formatFieldKey(key)}</Eyebrow>
            <div style={{
              marginTop: 6,
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1,
              background: 'var(--lf-rule)', borderRadius: 8, overflow: 'hidden',
              border: '1px solid var(--lf-rule)',
            }}>
              {entries.map(([subKey, subValue]) => (
                <div key={subKey} style={{
                  display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '8px 10px', background: 'var(--lf-paper)',
                }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11, color: 'var(--lf-muted)', letterSpacing: '0.04em',
                  }}>
                    {formatFieldKey(subKey)}
                  </div>
                  <div className={typeof subValue === 'number' ? 'ds-num' : ''} style={{
                    fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)',
                    fontFamily: typeof subValue === 'number' ? "'JetBrains Mono', monospace" : 'inherit',
                  }}>
                    {formatFieldValue(subValue)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
