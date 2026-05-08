import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Trash2, RefreshCw, Upload, X, HelpCircle, ShieldCheck, ChevronDown, FolderOpen } from "lucide-react";
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import { ActionItem } from "../components/common/action-item.js";
import { Section } from "../components/common/section.js";
import type { TaxDocument, TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useInsights } from "../hooks/useInsights.js";
import { usePageContext } from "../lib/page-context.js";
import { LegalDisclaimer } from "../components/common/legal-disclaimer.js";

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

/**
 * Estimate marginal tax bracket from annual income + filing status.
 * Brackets as of tax year 2024.
 */
function estimateBracket(income: number, filingStatus: string | null): string {
  const mfj = filingStatus === "married_joint";
  if (mfj) {
    if (income <= 23_200) return "10%";
    if (income <= 94_300) return "12%";
    if (income <= 201_050) return "22%";
    if (income <= 383_900) return "24%";
    if (income <= 487_450) return "32%";
    if (income <= 731_200) return "35%";
    return "37%";
  }
  // single / default
  if (income <= 11_600) return "10%";
  if (income <= 47_150) return "12%";
  if (income <= 100_525) return "22%";
  if (income <= 191_950) return "24%";
  if (income <= 243_725) return "32%";
  if (income <= 609_350) return "35%";
  return "37%";
}

// ─── shared inline style tokens ─────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "var(--lf-paper)",
  border: "1px solid var(--lf-rule)",
  borderRadius: 14,
};

const EYEBROW: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--lf-muted)",
};

const SERIF: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
};

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

/** Try to find a form type string from llmFields (handles various key names and nesting) */
function extractFormType(fields: Record<string, unknown>): string | null {
  if (!fields || typeof fields !== "object") return null;
  // Direct keys
  for (const k of ["document_type", "form_type", "documentType", "formType", "type", "form"]) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // Check nested "fields" object (some extractions nest inside { fields: { document_type: ... } })
  if (typeof fields.fields === "object" && fields.fields !== null) {
    const nested = extractFormType(fields.fields as Record<string, unknown>);
    if (nested) return nested;
  }
  return null;
}

/** Try to extract a form type from the summary text */
function extractFormTypeFromSummary(summary: string): string | null {
  if (!summary) return null;
  // Match common patterns: "1040 for tax year", "W-2 showing", "Form 1040", "1099-MISC from"
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

/** Derive a display label from a tax document summary */
function getDocLabel(doc: { llmFields?: Record<string, unknown> | null; llmSummary: string; fileName: string }): { label: string; formType: string | null } {
  // 1. Try llmFields
  const rawType = extractFormType((doc.llmFields ?? {}) as Record<string, unknown>);
  if (rawType) {
    const key = rawType.toLowerCase().replace(/\s+/g, "").replace("form", "");
    // Normalize key for lookup (remove "form" prefix, spaces)
    const lookupKey = rawType.toLowerCase().trim();
    const friendly = FORM_LABELS[lookupKey] || FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: rawType.toUpperCase() };
    return { label: rawType, formType: rawType.toUpperCase() };
  }

  // 2. Try the summary text
  const summaryType = extractFormTypeFromSummary(doc.llmSummary);
  if (summaryType) {
    const key = summaryType.toLowerCase().trim();
    const friendly = FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: summaryType.toUpperCase() };
    return { label: summaryType, formType: summaryType.toUpperCase() };
  }

  // 3. Use first sentence of summary if available
  if (doc.llmSummary) {
    const firstSentence = doc.llmSummary.split(/[.!]\s/)[0];
    if (firstSentence && firstSentence.length < 80) {
      return { label: firstSentence, formType: null };
    }
  }

  // 4. Fallback to filename without extension
  const nameNoExt = doc.fileName.replace(/\.[^.]+$/, "");
  return { label: nameNoExt, formType: null };
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
  const [expandedYears, setExpandedYears] = useState<Set<string>>(() => new Set());
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const safetyRef = useRef<HTMLDivElement>(null);

  const { insights, isLoading: insightsLoading, reload, refresh, dismiss } = useInsights("tax");
  const { setPageContext } = usePageContext();

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

  // ── data loading ────────────────────────────────────────────────────────────
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

  // ── handlers ─────────────────────────────────────────────────────────────
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
      // Insights are regenerated server-side after upload.
      // Poll for the updated insights after a delay.
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
      // Server regenerates insights on delete; poll after a delay
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

  // ── derived values ────────────────────────────────────────────────────────
  const filingLabel = profile?.filingStatus
    ? FILING_LABELS[profile.filingStatus] ?? profile.filingStatus
    : null;

  // Estimated tax savings: sum all dollar amounts from insight impacts
  const estimatedSavings = useMemo(() => {
    if (documents.length === 0 || insights.length === 0) return null;
    let total = 0;
    for (const ins of insights) {
      const amt = ins.impact ? parseDollarAmount(ins.impact) : 0;
      if (amt > 0) total += amt;
    }
    return total > 0 ? total : null;
  }, [insights, documents.length]);

  // Group documents by tax year, sorted descending. "Unknown" year goes last.
  const documentsByYear = useMemo(() => {
    const groups = new Map<string, TaxDocumentSummary[]>();
    for (const doc of documents) {
      const key = doc.taxYear ? String(doc.taxYear) : "Unknown";
      const list = groups.get(key) || [];
      list.push(doc);
      groups.set(key, list);
    }
    // Sort year keys descending, "Unknown" last
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return Number(b) - Number(a);
    });
    return sorted;
  }, [documents]);

  // Auto-expand all year groups on initial load
  useEffect(() => {
    if (documentsByYear.length > 0 && expandedYears.size === 0) {
      setExpandedYears(new Set(documentsByYear.map(([year]) => year)));
    }
  }, [documentsByYear, expandedYears.size]);

  const toggleYear = useCallback((year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }, []);

  // ── page context for AI chat ─────────────────────────────────────────────
  useEffect(() => {
    if (profile) {
      setPageContext({
        pageId: "tax",
        pageTitle: "Tax Strategy",
        description: "Tax optimization suggestions and uploaded document analysis.",
      });
    }
  }, [profile, setPageContext]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 4vw, 40px)",
        paddingBottom: "clamp(80px, 12vw, 48px)",
        background: "var(--lf-paper)",
        minHeight: 0,
        maxWidth: 1100,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
      className="scrollbar-thin"
    >
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        style={{ marginBottom: 28 }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1
              style={{
                ...SERIF,
                fontSize: 36,
                color: "var(--lf-ink)",
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              Tax Strategy
            </h1>
            <div style={{ ...EYEBROW, marginTop: 6 }}>
              {FILING_YEAR} filing year
            </div>
          </div>
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <button
              onClick={() => {
                const el = document.getElementById("tax-documents-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                ...EYEBROW,
                background: "var(--lf-ink)",
                color: "var(--lf-paper)",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Upload size={12} />
              Upload tax documents
            </button>
          )}
        </div>
      </motion.div>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.06 }}
        style={{
          background: "var(--lf-ink)", color: "var(--lf-paper)",
          borderRadius: 14, padding: "clamp(20px, 4vw, 32px)", marginBottom: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 24,
        }}
      >
        {/* Est. tax savings */}
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--lf-cheese)", marginBottom: 6 }}>Est. tax savings</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em", color: estimatedSavings ? "var(--lf-basil)" : "var(--lf-paper)" }}>
            {insightsLoading ? "…" : estimatedSavings ? formatMoney(estimatedSavings) : "—"}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#D4C6B0", marginTop: 8 }}>
            {insightsLoading
              ? "calculating…"
              : estimatedSavings
                ? "/yr from insights"
                : documents.length === 0
                  ? "Upload documents to estimate"
                  : "Upload more documents"}
          </div>
        </div>
        {/* Filing status */}
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--lf-cheese)", marginBottom: 6 }}>Filing status</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em" }}>{filingLabel ?? "—"}</div>
          {profile?.stateOfResidence && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#D4C6B0", marginTop: 8 }}>{profile.stateOfResidence}</div>}
        </div>
        {/* Documents count */}
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--lf-cheese)", marginBottom: 6 }}>Documents</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em" }}>{documents.length}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#D4C6B0", marginTop: 8 }}>tax {documents.length === 1 ? "document" : "documents"} uploaded</div>
        </div>
        {/* Insights count */}
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--lf-cheese)", marginBottom: 6 }}>Insights</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.02em", color: insights.length > 0 ? "var(--lf-cheese)" : "var(--lf-paper)" }}>{insightsLoading ? "…" : insights.length}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#D4C6B0", marginTop: 8 }}>tax {insights.length === 1 ? "insight" : "insights"}</div>
        </div>
      </motion.div>

      {/* ── Tax Insights ────────────────────────────────────────────────────── */}
      {!insightsLoading && insights.length > 0 && (
        <Section
          title={`Tax Insights${estimatedSavings ? " · " + formatMoney(estimatedSavings) + "/yr potential" : ""}`}
          actions={
            <button
              type="button"
              onClick={handleRefreshInsights}
              disabled={refreshingInsights}
              className="text-xs text-text-secondary hover:text-accent transition-colors disabled:opacity-50"
            >
              {refreshingInsights ? "↻ Refreshing…" : "↻ Refresh"}
            </button>
          }
        >
          <div className="bg-bg-elevated border border-border rounded-xl px-4">
            {insights.map((ins, i) => (
              <ActionItem
                key={ins.id}
                title={ins.title}
                tag={(ins.type ?? ins.category ?? "general").toUpperCase()}
                description={ins.description}
                impact={ins.impact ?? ""}
                impactColor={(ins.impactColor as "green" | "amber" | "red") ?? "amber"}
                chatPrompt={ins.chatPrompt ?? ins.title}
                defaultOpen={i === 0}
                onDismiss={() => dismiss(ins.id)}
              />
            ))}
            <LegalDisclaimer variant="insights" />
          </div>
        </Section>
      )}

      {/* ── Upload + Documents ─────────────────────────────────────────────── */}
      {import.meta.env.VITE_DEMO_MODE !== "true" && (
        <motion.div
          id="tax-documents-section"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.18 }}
          style={{ marginBottom: 20 }}
        >
          <div style={{ ...CARD, overflow: "hidden" }}>
            {/* Header */}
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--lf-rule)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={EYEBROW}>Upload documents</span>
                {/* Safety popover */}
                <div style={{ position: "relative" }} ref={safetyRef}>
                  <button
                    onClick={() => setShowSafety((p) => !p)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--lf-muted)",
                      display: "flex",
                      alignItems: "center",
                    }}
                    aria-label="Privacy & safety information"
                  >
                    <HelpCircle size={13} />
                  </button>
                  {showSafety && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 22,
                        zIndex: 50,
                        width: 280,
                        borderRadius: 12,
                        border: "1px solid var(--lf-rule)",
                        background: "var(--lf-paper)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                        padding: 16,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                        <ShieldCheck size={14} style={{ color: "var(--lf-basil)", flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--lf-ink)" }}>Privacy & security</span>
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
                          <div key={item} style={{ display: "flex", gap: 6, fontSize: 12, color: "var(--lf-muted)", lineHeight: 1.5 }}>
                            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--lf-muted)", flexShrink: 0, marginTop: 6, opacity: 0.5 }} />
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {insightStatus === "generating" && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      ...EYEBROW,
                      color: "var(--lf-cheese)",
                    }}
                  >
                    <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} />
                    Updating insights…
                  </span>
                )}
                {insightStatus === "done" && (
                  <span style={{ ...EYEBROW, color: "var(--lf-basil)" }}>Insights updated ✓</span>
                )}
              </div>
            </div>

            {/* Upload panel — full width */}
            <div style={{ padding: 16 }}>
              <TaxInputPanel onSuccess={handleInputSuccess} />
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Uploaded Documents (separate section) ─────────────────────────── */}
      {documents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.24 }}
          style={{ marginBottom: 20 }}
        >
          <div style={{ ...CARD, overflow: "hidden" }}>
            <div
              style={{
                padding: "14px 18px",
                borderBottom: "1px solid var(--lf-rule)",
              }}
            >
              <span style={EYEBROW}>Uploaded documents · {documents.length}</span>
            </div>

            <div
              className="tax-doc-layout"
              style={{
                display: "grid",
                gridTemplateColumns: selectedDoc ? "1fr 1fr" : "1fr",
                gap: 0,
              }}
            >
              {/* Document list — year accordion folders */}
              <div style={{ padding: 16, overflowY: "auto", maxHeight: 480 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {documentsByYear.map(([year, yearDocs]) => {
                    const isOpen = expandedYears.has(year);
                    return (
                      <div key={year}>
                        {/* Folder header */}
                        <button
                          onClick={() => toggleYear(year)}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "8px 10px",
                            background: "transparent",
                            border: "none",
                            borderRadius: 8,
                            cursor: "pointer",
                            transition: "background 0.12s",
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--lf-cream)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                        >
                          <ChevronDown
                            size={14}
                            style={{
                              color: "var(--lf-muted)",
                              flexShrink: 0,
                              transition: "transform 0.2s",
                              transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                            }}
                          />
                          <FolderOpen size={14} style={{ color: "var(--lf-cheese)", flexShrink: 0 }} />
                          <span style={{ ...EYEBROW, fontSize: 12 }}>
                            {year === "Unknown" ? "Unknown Year" : year}
                          </span>
                          <span style={{ ...EYEBROW, fontSize: 11, opacity: 0.5, marginLeft: "auto" }}>
                            {yearDocs.length}
                          </span>
                        </button>

                        {/* Folder contents */}
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeInOut" }}
                              style={{ overflow: "hidden" }}
                            >
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 0 8px 22px" }}>
                                {yearDocs.map((doc, i) => {
                                  const isSelected = selectedDoc?.id === doc.id;
                                  const isLoading = docLoading === doc.id;
                                  const isConfirming = deleteConfirmId === doc.id;
                                  const { label } = getDocLabel(doc);
                                  const uploadDate = doc.createdAt
                                    ? new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                      + " at "
                                      + new Date(doc.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                    : null;
                                  return (
                                    <motion.div
                                      key={doc.id}
                                      initial={{ opacity: 0, x: -4 }}
                                      animate={{ opacity: 1, x: 0 }}
                                      transition={{ delay: i * 0.03 }}
                                      onClick={() => handleSelectDocument(doc.id)}
                                      style={{
                                        background: isSelected ? "var(--lf-ink)" : "var(--lf-cream)",
                                        color: isSelected ? "var(--lf-paper)" : "var(--lf-ink)",
                                        border: `1px solid ${isSelected ? "var(--lf-ink)" : "var(--lf-rule)"}`,
                                        borderRadius: 8,
                                        padding: "8px 12px",
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                        cursor: "pointer",
                                        transition: "background 0.15s, border-color 0.15s, color 0.15s",
                                      }}
                                    >
                                      <FileText
                                        size={14}
                                        style={{ color: isSelected ? "var(--lf-cheese)" : "var(--lf-muted)", flexShrink: 0, marginTop: 2 }}
                                      />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontSize: 13,
                                            fontWeight: 500,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                        >
                                          {label}
                                        </div>
                                        <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2, display: "flex", gap: 8 }}>
                                          {uploadDate && <span>{uploadDate}</span>}
                                          <span>{doc.fileName}</span>
                                        </div>
                                        {!isSelected && doc.llmSummary && (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: isSelected ? undefined : "var(--lf-muted)",
                                              opacity: isSelected ? 0.7 : 1,
                                              marginTop: 3,
                                              lineHeight: 1.4,
                                              display: "-webkit-box",
                                              WebkitLineClamp: 2,
                                              WebkitBoxOrient: "vertical" as const,
                                              overflow: "hidden",
                                            }}
                                          >
                                            {doc.llmSummary}
                                          </div>
                                        )}
                                      </div>
                                      {isLoading && (
                                        <RefreshCw size={12} style={{ color: isSelected ? "var(--lf-cheese)" : "var(--lf-muted)", flexShrink: 0, marginTop: 2, animation: "spin 1s linear infinite" }} />
                                      )}
                                      {import.meta.env.VITE_DEMO_MODE !== "true" && (
                                        isConfirming ? (
                                          <div
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ display: "flex", gap: 4, flexShrink: 0 }}
                                          >
                                            <button
                                              onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc.id); setDeleteConfirmId(null); }}
                                              style={{
                                                background: "var(--lf-sauce)",
                                                border: "none",
                                                cursor: "pointer",
                                                padding: "2px 8px",
                                                borderRadius: 4,
                                                color: "var(--lf-paper)",
                                                fontSize: 11,
                                                fontWeight: 600,
                                              }}
                                            >
                                              Delete
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                                              style={{
                                                background: "transparent",
                                                border: `1px solid ${isSelected ? "var(--lf-paper)" : "var(--lf-rule)"}`,
                                                cursor: "pointer",
                                                padding: "2px 8px",
                                                borderRadius: 4,
                                                color: isSelected ? "var(--lf-paper)" : "var(--lf-muted)",
                                                fontSize: 11,
                                                fontWeight: 600,
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(doc.id); }}
                                            style={{
                                              background: "transparent",
                                              border: "none",
                                              cursor: "pointer",
                                              padding: 4,
                                              borderRadius: 6,
                                              color: isSelected ? "var(--lf-paper)" : "var(--lf-muted)",
                                              flexShrink: 0,
                                              opacity: 0.6,
                                              transition: "opacity 0.15s",
                                            }}
                                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        )
                                      )}
                                    </motion.div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Detail side panel */}
              <AnimatePresence>
                {selectedDoc && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    style={{
                      borderLeft: "1px solid var(--lf-rule)",
                      overflow: "hidden",
                    }}
                    className="tax-doc-detail"
                  >
                    <DocumentDetail doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}

      {/* Responsive style override for narrow viewports */}
      <style>{`
        @media (max-width: 700px) {
          .tax-doc-layout {
            grid-template-columns: 1fr !important;
          }
          .tax-doc-detail {
            border-left: none !important;
            border-top: 1px solid var(--lf-rule);
          }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function MiniCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        background: "var(--lf-paper)",
        border: "1px solid var(--lf-rule)",
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div style={{ ...EYEBROW, fontSize: 13, marginBottom: 8 }}>{label}</div>
      <div
        style={{
          ...SERIF,
          fontSize: 22,
          color: valueColor ?? "var(--lf-ink)",
          lineHeight: 1,
          marginBottom: sub ? 5 : 0,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 13, color: "var(--lf-muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    // Format as currency if it looks like money (> 1 and not a year)
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
  // Arrays and objects — won't produce [Object object]
  if (Array.isArray(value)) {
    return value.map((v) => formatFieldValue(v)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/** Check if a value is a nested object (not null, not array, not primitive) */
function isNestedObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function DocumentDetail({ doc, onClose }: { doc: TaxDocument; onClose: () => void }) {
  const fields = doc.llmFields as Record<string, unknown>;
  const fieldEntries = Object.entries(fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  // Metadata fields shown as badges above the grid, not in the grid
  const docType = fields.document_type || fields.form_type || null;
  const taxYear = fields.tax_year ?? doc.taxYear ?? null;
  const metaKeys = new Set(["document_type", "form_type", "tax_year"]);
  // Split into flat fields and nested objects
  const flatFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && !isNestedObject(v)
  );
  const nestedFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && isNestedObject(v)
  );

  return (
    <div
      style={{
        padding: "16px",
        overflowY: "auto",
        maxHeight: 400,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {docType && (
            <span
              style={{
                ...EYEBROW,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                background: "var(--lf-ink)",
                color: "var(--lf-cheese)",
              }}
            >
              {String(docType)}
            </span>
          )}
          {taxYear && (
            <span
              style={{
                ...EYEBROW,
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                background: "var(--lf-cream)",
                color: "var(--lf-ink)",
                border: "1px solid var(--lf-rule)",
              }}
            >
              Tax Year {String(taxYear)}
            </span>
          )}
          <span style={{ ...EYEBROW, fontSize: 11 }}>Extracted fields</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--lf-muted)",
            borderRadius: 4,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* File name */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--lf-ink)", marginBottom: 8 }}>
        {doc.fileName}
      </div>

      {/* Summary */}
      {doc.llmSummary && (
        <div
          style={{
            fontSize: 13,
            color: "var(--lf-ink-soft)",
            lineHeight: 1.5,
            marginBottom: 14,
            padding: "10px 12px",
            background: "var(--lf-cream)",
            borderRadius: 8,
          }}
        >
          {doc.llmSummary}
        </div>
      )}

      {/* Flat fields table */}
      {flatFields.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1px",
            background: "var(--lf-rule)",
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--lf-rule)",
          }}
        >
          {flatFields.map(([key, value]) => (
            <div
              key={key}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 10px",
                background: "var(--lf-paper)",
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: "var(--lf-muted)",
                  letterSpacing: "0.04em",
                }}
              >
                {formatFieldKey(key)}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--lf-ink)",
                  fontFamily:
                    typeof value === "number"
                      ? "'JetBrains Mono', monospace"
                      : "inherit",
                }}
              >
                {formatFieldValue(value)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !nestedFields.length && (
          <div
            style={{
              fontSize: 13,
              color: "var(--lf-muted)",
              textAlign: "center",
              padding: "16px 0",
            }}
          >
            No extracted fields available.
          </div>
        )
      )}

      {/* Nested object sections */}
      {nestedFields.map(([key, value]) => {
        const obj = value as Record<string, unknown>;
        const entries = Object.entries(obj).filter(
          ([, v]) => v !== null && v !== undefined && v !== ""
        );
        if (!entries.length) return null;
        return (
          <div key={key} style={{ marginTop: 14 }}>
            <div
              style={{
                ...EYEBROW,
                fontSize: 11,
                marginBottom: 6,
              }}
            >
              {formatFieldKey(key)}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1px",
                background: "var(--lf-rule)",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--lf-rule)",
              }}
            >
              {entries.map(([subKey, subValue]) => (
                <div
                  key={subKey}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    padding: "8px 10px",
                    background: "var(--lf-paper)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: "var(--lf-muted)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {formatFieldKey(subKey)}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--lf-ink)",
                      fontFamily:
                        typeof subValue === "number"
                          ? "'JetBrains Mono', monospace"
                          : "inherit",
                    }}
                  >
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

