import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Trash2,
  RefreshCw,
  Upload,
  X,
  ShieldCheck,
  FolderOpen,
  ArrowRight,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Info,
  Receipt,
  PiggyBank,
} from "lucide-react";
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import type { TaxDocument, TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { useInsights } from "../hooks/useInsights.js";
import { usePageContext } from "../lib/page-context.js";
import { useChatStore } from "../lib/chat-store.js";
import { Button, Badge, EmptyState, Skeleton } from "../components/uikit";

// ─── helpers ────────────────────────────────────────────────────────────────

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  head_of_household: "Head of Household",
};

const FILING_ABBR: Record<string, string> = {
  single: "Single",
  married_joint: "MFJ",
  married_separate: "MFS",
  head_of_household: "HoH",
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

// How many document rows to show before collapsing behind a "show all" toggle —
// keeps a long library (e.g. a full return's 19 schedules) from becoming an
// endless scroll on mobile.
const DOC_PREVIEW_COUNT = 6;

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

// impactColor (red / green / amber) → tinted value colors, mirroring insights.
function impactColorVar(color?: string | null): string {
  if (color === "red") return "rgb(var(--ui-negative))";
  if (color === "green") return "rgb(var(--ui-positive))";
  return "rgb(var(--ui-caution))";
}
function impactSoftVar(color?: string | null): string {
  if (color === "red") return "var(--ui-negative-soft)";
  if (color === "green") return "var(--ui-positive-soft)";
  return "var(--ui-caution-soft)";
}

// impactColor → a priority tag (icon + tone + label), meaning never color-only.
function priorityTag(color?: string | null): { label: string; tone: "negative" | "positive" | "caution"; Icon: typeof Sparkles } {
  if (color === "red") return { label: "High priority", tone: "negative", Icon: AlertTriangle };
  if (color === "green") return { label: "Opportunity", tone: "positive", Icon: TrendingUp };
  return { label: "Worth a look", tone: "caution", Icon: Sparkles };
}

// ─── types ───────────────────────────────────────────────────────────────────

interface Profile {
  filingStatus: string | null;
  annualIncome: number | null;
  stateOfResidence: string | null;
}

interface SavingsLine {
  title: string;
  amount: number;
  color: string | null;
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
  const [showAllDocs, setShowAllDocs] = useState(false);
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
  const filingAbbr = profile?.filingStatus
    ? FILING_ABBR[profile.filingStatus] ?? filingLabel
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

  // Where the savings come from — the hero's visual echo. Real insight impacts,
  // largest first. Never fabricated: only strategies with a parsed $ amount.
  const savingsBreakdown = useMemo<SavingsLine[]>(() => {
    return insights
      .map((ins) => ({
        title: ins.title,
        amount: ins.impact ? parseDollarAmount(ins.impact) : 0,
        color: ins.impactColor,
      }))
      .filter((l) => l.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [insights]);

  useEffect(() => {
    if (profile) {
      setPageContext({
        pageId: "tax",
        pageTitle: "Tax Strategy",
        description: "Tax optimization suggestions and uploaded document analysis.",
      });
    }
  }, [profile, setPageContext]);

  const showUpload = import.meta.env.VITE_DEMO_MODE !== "true";

  const scrollToUpload = () => {
    document.getElementById("tax-documents-section")?.scrollIntoView({ behavior: "smooth" });
  };

  // Subtitle bits — filing year + live document/action counts.
  const subBits: string[] = [`${FILING_YEAR} filing year`];
  if (documents.length > 0) subBits.push(`${documents.length} doc${documents.length === 1 ? "" : "s"}`);
  if (insights.length > 0) subBits.push(`${insights.length} strateg${insights.length === 1 ? "y" : "ies"}`);
  const subtitleText = subBits.join(" · ");

  const hasDocs = documents.length > 0;
  const strategyCount = insights.length;
  const topAmount = savingsBreakdown[0]?.amount ?? 0;

  return (
    <div className="mx-auto max-w-[1120px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`
        @media (max-width: 640px) {
          .tax-input-wrap input[type="text"],
          .tax-input-wrap input[type="url"],
          .tax-input-wrap input[type="number"],
          .tax-input-wrap input:not([type]),
          .tax-input-wrap textarea,
          .tax-input-wrap select {
            font-size: 16px !important;
          }
        }
      `}</style>

      {/* ── Header ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-2.5 mb-2.5">
            <span
              className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              Tax workspace
            </span>
          </span>
          <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
            How do I lower my taxes?
          </h1>
          <p className="mt-1.5 text-[14px] font-medium text-content-muted">{subtitleText}</p>
        </div>
        {showUpload && (
          <Button
            variant="primary"
            size="sm"
            className="w-full sm:w-auto"
            leadingIcon={<Upload size={15} />}
            onClick={scrollToUpload}
          >
            {hasDocs ? "Add a document" : "Upload documents"}
          </Button>
        )}
      </header>

      {/* ══════════ ZONE 1 — How do I lower my taxes? ══════════ */}

      {/* ── HERO — the one confident answer: savings on the table ── */}
      <section
        data-hero
        className="relative mt-6 sm:mt-7 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-8"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(92% 82% at 0% 0%, var(--ui-brand-softer), transparent 60%)," +
              "radial-gradient(84% 74% at 100% 0%, var(--ui-accent-softer), transparent 62%)",
          }}
        />
        <div className="relative grid items-center gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
          {/* lead — the number */}
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
              {hasDocs ? `Estimated ${FILING_YEAR} savings on the table` : "Your tax workspace"}
            </div>

            {hasDocs ? (
              <>
                <div className="mt-2.5 flex items-end gap-3 flex-wrap">
                  <span className="font-editorial text-[42px] sm:text-[58px] font-extrabold leading-[0.85] tracking-[-0.03em] text-[rgb(var(--ui-brand-ink))] ui-tnum">
                    {insightsLoading ? "…" : estimatedSavings ? formatMoney(estimatedSavings) : "—"}
                  </span>
                  {!insightsLoading && strategyCount > 0 && (
                    <span
                      className="mb-1.5 inline-flex items-center h-7 px-3 rounded-full text-[12.5px] font-bold"
                      style={{ background: "var(--ui-brand-soft)", color: "rgb(var(--ui-brand-ink))" }}
                    >
                      {strategyCount} strateg{strategyCount === 1 ? "y" : "ies"}
                    </span>
                  )}
                </div>
                <p className="mt-4 text-[15px] leading-[1.55] text-content-secondary max-w-[52ch]">
                  {insightsLoading ? (
                    <>Scanning your {documents.length} document{documents.length === 1 ? "" : "s"} for ways to lower your {FILING_YEAR} taxes…</>
                  ) : strategyCount > 0 ? (
                    <>
                      From the <strong className="font-bold text-content ui-tnum">{documents.length}</strong>{" "}
                      document{documents.length === 1 ? "" : "s"} on file, we found{" "}
                      <strong className="font-bold text-content ui-tnum">{strategyCount}</strong>{" "}
                      {strategyCount === 1 ? "way" : "ways"} to keep more of your money this year.
                      {estimatedSavings ? " Work through the moves below to claim it." : " Review the moves below."}
                    </>
                  ) : (
                    <>Your documents are in and extracted. Strategies to lower your {FILING_YEAR} taxes will
                    appear here as we analyze them — or refresh below.</>
                  )}
                </p>

                {/* filing context chips */}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {filingAbbr && (
                    <span
                      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-bold border border-line bg-canvas-sunken/60 text-content-secondary"
                      title={filingLabel ?? undefined}
                    >
                      <Receipt className="h-3 w-3 text-content-muted" />
                      {filingAbbr}
                    </span>
                  )}
                  {profile?.stateOfResidence && (
                    <span className="inline-flex items-center h-7 px-3 rounded-full text-[12px] font-bold border border-line bg-canvas-sunken/60 text-content-secondary">
                      {profile.stateOfResidence}
                    </span>
                  )}
                  <span className="inline-flex items-center h-7 px-3 rounded-full text-[12px] font-bold border border-line bg-canvas-sunken/60 text-content-secondary ui-tnum">
                    {FILING_YEAR} filing year
                  </span>
                </div>
              </>
            ) : (
              <>
                <h2 className="mt-2.5 font-editorial text-[30px] sm:text-[40px] font-extrabold leading-[1.02] tracking-[-0.028em] text-content">
                  See what you could save
                </h2>
                <p className="mt-4 text-[15px] leading-[1.55] text-content-secondary max-w-[50ch]">
                  Add your W-2s, 1099s, or any tax form. We extract the fields, surface the deductions and
                  credits you qualify for, and never store the original file.
                </p>
                {showUpload && (
                  <div className="mt-6">
                    <Button
                      variant="primary"
                      size="sm"
                      leadingIcon={<Upload size={15} />}
                      onClick={scrollToUpload}
                    >
                      Upload your first document
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* visual echo — where the savings come from */}
          <div className="min-w-0">
            {insightsLoading && hasDocs ? (
              <div className="rounded-ui-lg border border-line bg-panel/70 p-4 sm:p-5">
                <Skeleton className="h-3 w-32" />
                <div className="mt-4 flex flex-col gap-3.5">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="mt-2 h-2 w-full rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            ) : savingsBreakdown.length > 0 ? (
              <div className="rounded-ui-lg border border-line bg-panel/70 p-4 sm:p-5 shadow-ui-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
                  <TrendingUp className="h-3.5 w-3.5 text-[rgb(var(--ui-brand-ink))]" />
                  Where it comes from
                </div>
                <div className="mt-4 flex flex-col gap-3.5">
                  {savingsBreakdown.slice(0, 4).map((line) => (
                    <SavingsLineBar key={line.title} line={line} max={topAmount} />
                  ))}
                </div>
                {savingsBreakdown.length > 4 && (
                  <div className="mt-3.5 text-[12px] font-semibold text-content-muted">
                    +{savingsBreakdown.length - 4} more{" "}
                    {savingsBreakdown.length - 4 === 1 ? "strategy" : "strategies"} below
                  </div>
                )}
              </div>
            ) : strategyCount > 0 ? (
              <div className="rounded-ui-lg border border-line bg-panel/70 p-4 sm:p-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
                  What we found
                </div>
                <div className="mt-3.5 flex flex-col gap-2.5">
                  {insights.slice(0, 3).map((ins) => (
                    <div key={ins.id} className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: impactColorVar(ins.impactColor) }}
                        aria-hidden
                      />
                      <span className="text-[13.5px] font-semibold leading-snug text-content-secondary line-clamp-2">
                        {ins.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // decorative echo for the empty invitation
              <div className="hidden lg:flex items-center justify-center">
                <div
                  className="grid h-[132px] w-[132px] place-items-center rounded-ui-xl border border-line"
                  style={{
                    background:
                      "linear-gradient(150deg, var(--ui-brand-soft), var(--ui-accent-soft))",
                  }}
                >
                  <PiggyBank className="h-14 w-14 text-[rgb(var(--ui-brand-ink))]" strokeWidth={1.5} />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Supporting facts strip ── */}
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <StatItem
          label="Filing status"
          value={filingAbbr ?? "—"}
          sub={
            filingLabel
              ? profile?.stateOfResidence
                ? `${filingLabel} · ${profile.stateOfResidence}`
                : filingLabel
              : profile?.stateOfResidence ?? "not set"
          }
        />
        <StatItem label="Documents on file" value={String(documents.length)} sub={hasDocs ? "extracted & stored" : "none yet"} />
        <StatItem
          label="Strategies"
          value={insightsLoading ? "…" : String(strategyCount)}
          sub={strategyCount === 1 ? "to review" : "to review"}
        />
        <StatItem label="Filing year" value={String(FILING_YEAR)} sub="tax year" />
      </div>

      {/* ── Strategies — the concrete moves ── */}
      {insightsLoading ? (
        <section className="mt-10" aria-hidden>
          <Skeleton className="h-6 w-56" />
          <div className="mt-4 flex flex-col gap-3.5">
            {[0, 1].map((i) => (
              <div key={i} className="rounded-ui-lg border border-line bg-panel shadow-ui-sm p-6">
                <Skeleton className="h-[26px] w-28 rounded-full" />
                <Skeleton className="mt-3 h-5 w-2/3" />
                <Skeleton className="mt-2 h-4 w-full" />
                <Skeleton className="mt-4 h-9 w-40 rounded-ui-md" />
              </div>
            ))}
          </div>
        </section>
      ) : insights.length > 0 ? (
        <section className="mt-10 sm:mt-12">
          <div className="flex items-end justify-between gap-4 px-1 pb-3.5">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]">
                {estimatedSavings ? `${formatMoney(estimatedSavings)}/yr potential` : `${insights.length} to review`}
              </span>
              <h2 className="mt-1 font-editorial text-[21px] sm:text-[23px] font-bold tracking-[-0.02em]">
                Ways to lower your taxes
              </h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshInsights}
              disabled={refreshingInsights}
              className="bg-brand-soft text-[rgb(var(--ui-brand-ink))] font-bold hover:bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm"
              leadingIcon={<RefreshCw size={15} className={refreshingInsights ? "animate-spin" : ""} />}
            >
              {refreshingInsights ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          <div className="flex flex-col gap-3.5">
            {insights.map((ins, idx) => (
              <TaxActionCard
                key={ins.id}
                index={idx}
                title={ins.title}
                description={ins.description}
                impact={ins.impact}
                impactColor={ins.impactColor}
                onAsk={() => openChat(ins.chatPrompt ?? ins.title)}
                onDismiss={() => dismiss(ins.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ══════════ ZONE 2 — What have I got on file? ══════════ */}
      <section id="tax-documents-section" className="mt-10 sm:mt-14 scroll-mt-6">
        <div className="flex items-end justify-between gap-3 px-1 pb-3.5">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]">
              On file
            </span>
            <h2 className="mt-1 font-editorial text-[21px] sm:text-[23px] font-bold tracking-[-0.02em]">
              Your documents
            </h2>
          </div>
          <span className="text-[13px] font-semibold text-content-muted">
            {documents.length > 0 ? `${documents.length} uploaded` : "None yet"}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
          {/* Add a document — the upload / describe tool */}
          {showUpload && (
            <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm lg:sticky lg:top-6">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-ui-md bg-brand-soft text-[rgb(var(--ui-brand-ink))]">
                    <Upload size={15} />
                  </span>
                  <span className="text-[14px] font-bold text-content">Add a document</span>
                </div>
                <div className="flex items-center gap-2">
                  {insightStatus === "generating" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-caution">
                      <RefreshCw size={11} className="animate-spin" />
                      Updating
                    </span>
                  )}
                  {insightStatus === "done" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-positive">
                      Updated
                    </span>
                  )}
                  <div className="relative" ref={safetyRef}>
                    <button
                      onClick={() => setShowSafety((p) => !p)}
                      className="touch-target ui-focus grid h-9 w-9 place-items-center rounded-ui-md border border-line text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
                      aria-label="Privacy & safety information"
                    >
                      <ShieldCheck size={15} />
                    </button>
                    {showSafety && (
                      <div className="animate-scale-in absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] origin-top-right rounded-ui-lg border border-line-strong bg-panel-raised p-4 text-left shadow-ui-lg">
                        <div className="mb-2.5 flex items-center gap-2">
                          <ShieldCheck size={14} className="shrink-0 text-positive" />
                          <span className="text-[13px] font-bold text-content">Privacy & security</span>
                          <button
                            onClick={() => setShowSafety(false)}
                            className="ml-auto text-content-muted hover:text-content"
                            aria-label="Close"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          {[
                            "Open-weight models with zero data retention — documents never used for training.",
                            "Documents sent over HTTPS, used only for field extraction.",
                            "Only extracted tax fields are stored — not the original file.",
                            "Prefer not to upload? Use the text option to describe your situation.",
                          ].map((item) => (
                            <div key={item} className="flex gap-2 text-[12.5px] leading-relaxed text-content-secondary">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-content-faint" />
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="tax-input-wrap p-5">
                <TaxInputPanel onSuccess={handleInputSuccess} />
              </div>
            </div>
          )}

          {/* Document library — list + reachable detail */}
          <div className={cn(!showUpload && "lg:col-span-2")}>
            {documents.length === 0 ? (
              <EmptyState
                icon={<FolderOpen size={24} />}
                title="No documents yet"
                description={
                  showUpload
                    ? "Add a W-2, 1099, or any tax form. We extract the fields, surface deductions, and never store the original file."
                    : "Uploaded tax forms and their extracted fields will show up here."
                }
              />
            ) : (
              <div className="overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm">
                {(showAllDocs ? documents : documents.slice(0, DOC_PREVIEW_COUNT)).map((doc) => (
                  <Fragment key={doc.id}>
                    <DocRow
                      doc={doc}
                      selected={selectedDoc?.id === doc.id}
                      loading={docLoading === doc.id}
                      confirming={deleteConfirmId === doc.id}
                      showDelete={showUpload}
                      onSelect={() => handleSelectDocument(doc.id)}
                      onAskDelete={() => setDeleteConfirmId(doc.id)}
                      onConfirmDelete={() => {
                        handleDeleteDocument(doc.id);
                        setDeleteConfirmId(null);
                      }}
                      onCancelDelete={() => setDeleteConfirmId(null)}
                    />
                    {/* Detail expands inline right under the tapped row — reachable
                        on every viewport, never buried below the full list. */}
                    <AnimatePresence initial={false}>
                      {selectedDoc?.id === doc.id && (
                        <motion.div
                          key={`${doc.id}-detail`}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: "easeInOut" }}
                          className="overflow-hidden border-t border-line bg-canvas-sunken/40"
                        >
                          <DocumentDetail doc={selectedDoc} onClose={() => setSelectedDoc(null)} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Fragment>
                ))}

                {documents.length > DOC_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setShowAllDocs((p) => !p)}
                    className="touch-target ui-focus flex w-full items-center justify-center gap-1.5 border-t border-line bg-canvas-sunken/40 px-4 py-3 text-[13px] font-bold text-[rgb(var(--ui-brand-ink))] transition-colors hover:bg-canvas-sunken"
                  >
                    {showAllDocs
                      ? "Show fewer"
                      : `Show all ${documents.length} documents`}
                    <ArrowRight
                      size={14}
                      className={cn("transition-transform", showAllDocs ? "-rotate-90" : "rotate-90")}
                    />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

// Supporting fact — the retirement "border-l" KPI treatment.
function StatItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-l-2 border-line pl-3.5">
      <div className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">
        {label}
      </div>
      <div className="mt-1.5 font-editorial text-[22px] sm:text-[24px] font-extrabold leading-none tracking-[-0.02em] text-content ui-tnum">
        {value}
      </div>
      {sub && <div className="mt-1.5 truncate text-[12px] font-medium text-content-muted">{sub}</div>}
    </div>
  );
}

// One line of the hero savings breakdown — a strategy's $ contribution as a bar.
function SavingsLineBar({ line, max }: { line: SavingsLine; max: number }) {
  const pct = max > 0 ? Math.max((line.amount / max) * 100, 8) : 8;
  const color = impactColorVar(line.color);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12.5px] font-semibold text-content-secondary" title={line.title}>
          {line.title}
        </span>
        <span className="shrink-0 text-[12.5px] font-extrabold ui-tnum" style={{ color }}>
          {formatMoney(line.amount)}
        </span>
      </div>
      <div className="mt-1.5 h-[7px] rounded-full bg-canvas-sunken overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: color, transition: "width 0.6s ease" }}
        />
      </div>
    </div>
  );
}

// Recommended-action card — home "three moves" anatomy, Bright actions skin.
function TaxActionCard({
  index,
  title,
  description,
  impact,
  impactColor,
  onAsk,
  onDismiss,
}: {
  index: number;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  const tag = priorityTag(impactColor);
  const TagIcon = tag.Icon;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-[20px_18px] sm:p-[22px_24px] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md"
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: impactColorVar(impactColor) }}
        aria-hidden
      />

      <div className="flex items-start sm:items-center gap-5 flex-wrap sm:flex-nowrap">
        <div className="flex-1 min-w-0">
          <Badge tone={tag.tone} size="sm" className="mb-3 font-bold uppercase tracking-[0.05em]">
            <TagIcon className="h-3 w-3" />
            {tag.label}
          </Badge>
          <h3 className="font-editorial text-[18px] sm:text-[20px] font-bold leading-[1.2] tracking-[-0.018em] text-content">
            {title}
          </h3>
          {description && (
            <p className="mt-2 text-[14px] leading-[1.5] text-content-secondary line-clamp-3 max-w-[52ch]">
              {description}
            </p>
          )}
        </div>

        {impact && (
          <div className="w-full sm:w-auto mt-3.5 sm:mt-0 pt-3.5 sm:pt-0 border-t sm:border-t-0 border-line shrink-0">
            <span
              className="inline-flex items-center gap-1.5 rounded-ui-md px-2.5 py-1.5 font-editorial text-[14.5px] font-extrabold leading-[1.25] tracking-[-0.01em] ui-tnum whitespace-nowrap"
              style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
            >
              {impact}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-5 flex-wrap">
        <Button
          size="sm"
          onClick={onAsk}
          leadingIcon={<Sparkles className="h-3.5 w-3.5" />}
          trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}
        >
          Ask Lasagna about this
        </Button>
        <span className="hidden sm:block flex-1 min-w-[8px]" aria-hidden />
        <button
          type="button"
          onClick={onDismiss}
          className="touch-target h-9 px-3.5 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
        >
          Dismiss
        </button>
      </div>
    </motion.article>
  );
}

// Document list row — icon · label/filename · type/year/date · delete.
function DocRow({
  doc,
  selected,
  loading,
  confirming,
  showDelete,
  onSelect,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  doc: TaxDocumentSummary;
  selected: boolean;
  loading: boolean;
  confirming: boolean;
  showDelete: boolean;
  onSelect: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { label, formType } = getDocLabel(doc);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "ui-focus flex cursor-pointer items-center gap-3.5 border-t border-line px-4 py-3.5 transition-colors first:border-t-0 sm:px-5",
        selected ? "bg-brand-soft" : "hover:bg-brand-softer",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-ui-md",
          selected ? "bg-brand text-brand-fg" : "bg-canvas-sunken text-content-secondary",
        )}
      >
        <FileText size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-bold leading-tight text-content" title={label}>
          {label}
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-content-muted">{doc.fileName}</div>
        {formType && (
          <span className="mt-1.5 inline-flex sm:hidden">
            <Badge tone="neutral" size="sm">{formType}</Badge>
          </span>
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-4 sm:flex">
        {formType && <Badge tone="neutral" size="sm">{formType}</Badge>}
        {doc.taxYear && <span className="text-[13px] font-medium text-content-muted ui-tnum">{doc.taxYear}</span>}
        {doc.createdAt && (
          <span className="text-[13px] font-medium text-content-muted ui-tnum">
            {new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {loading && <RefreshCw size={13} className="animate-spin text-content-muted" />}
        {showDelete &&
          (confirming ? (
            <div className="flex items-center gap-1.5">
              <button
                onClick={onConfirmDelete}
                className="touch-target ui-focus rounded-ui-sm bg-negative-soft px-2.5 py-1 text-[12px] font-bold text-negative hover:bg-negative/15"
              >
                Delete
              </button>
              <button
                onClick={onCancelDelete}
                className="touch-target ui-focus rounded-ui-sm px-2.5 py-1 text-[12px] font-semibold text-content-muted hover:bg-canvas-sunken"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onAskDelete}
              className="touch-target ui-focus grid h-11 w-11 place-items-center rounded-ui-md border border-line bg-canvas-sunken text-content-muted transition-colors hover:border-negative/30 hover:bg-negative-soft hover:text-negative sm:h-9 sm:w-9 sm:rounded-ui-sm sm:border-0 sm:bg-transparent"
              aria-label="Delete document"
            >
              <Trash2 size={16} />
            </button>
          ))}
      </div>
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

function FieldGrid({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ui-md border border-line bg-line">
      {entries.map(([key, value], i) => (
        <div
          key={key}
          className={cn(
            "flex flex-col gap-1 bg-panel px-3 py-2",
            entries.length % 2 === 1 && i === entries.length - 1 && "col-span-2",
          )}
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-content-muted">
            {formatFieldKey(key)}
          </div>
          <div
            className={cn(
              "text-[14px] font-semibold text-content",
              typeof value === "number" && "ui-tnum",
            )}
          >
            {formatFieldValue(value)}
          </div>
        </div>
      ))}
    </div>
  );
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
    <div className="max-h-[480px] overflow-y-auto p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {docType && (
            <Badge tone="brand" size="sm">
              <Receipt className="h-3 w-3" />
              {String(docType)}
            </Badge>
          )}
          {taxYear && <Badge tone="neutral" size="sm">Tax Year {String(taxYear)}</Badge>}
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
            Extracted fields
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="touch-target ui-focus grid h-8 w-8 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
          aria-label="Close detail"
        >
          <X size={15} />
        </button>
      </div>

      <div className="mb-2.5 text-[14px] font-bold text-content">{doc.fileName}</div>

      {doc.llmSummary && (
        <div className="mb-3.5 flex gap-2 rounded-ui-md bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-content-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted" />
          {doc.llmSummary}
        </div>
      )}

      {flatFields.length > 0 ? (
        <FieldGrid entries={flatFields} />
      ) : (
        !nestedFields.length && (
          <div className="py-4 text-center text-[13px] text-content-muted">
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
          <div key={key} className="mt-3.5">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
              {formatFieldKey(key)}
            </div>
            <FieldGrid entries={entries} />
          </div>
        );
      })}
    </div>
  );
}
