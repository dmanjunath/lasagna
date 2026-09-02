import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FileText,
  Trash2,
  RefreshCw,
  X,
  ShieldCheck,
  FolderOpen,
  ChevronRight,
  Info,
  Receipt,
} from "lucide-react";
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import type { TaxDocument, TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { cn, splitParagraphs, formatRelativeTime, exactSyncTime } from "../lib/utils.js";
import { useInsights } from "../hooks/useInsights.js";
import { usePageContext } from "../lib/page-context.js";
import { ActionItem } from "../components/common/action-item.js";
import { Button, Badge, EmptyState, PageMeta, PageMetaItem, PageMetaSkeleton, Skeleton, SkeletonText, Alert, Select, Tooltip, useToast } from "../components/uikit";
import { useConfirm } from "../components/ds";
import { useIsMobile } from "../lib/hooks/use-mobile.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married Filing Jointly",
  married_separate: "Married Filing Separately",
  head_of_household: "Head of Household",
};

/** The insight `type` this page filters on. Shared by the hook call and poll. */
const TAX_INSIGHT_TYPE = "tax";

const FILING_YEAR = new Date().getFullYear() - 1;

/**
 * "Updated 3m ago" with the exact moment one hover or one Tab away. Same idiom
 * as every other timestamp in the app (simple-money, account-detail): a real
 * Tooltip rather than a native title, which is slow, unstyled, and invisible
 * to the keyboard.
 */
function TimeStamp({ iso }: { iso: string }) {
  const exact = exactSyncTime(iso);
  const label = (
    <span className="text-[12px] font-semibold text-content-muted">
      Updated {formatRelativeTime(new Date(iso))}
    </span>
  );
  if (!exact) return label;
  return (
    <Tooltip content={exact}>
      <span
        tabIndex={0}
        aria-label={`Summary updated ${exact}`}
        className="ui-focus inline-block rounded-ui-sm"
      >
        {label}
      </span>
    </Tooltip>
  );
}

/** Segment key for a document's tax year. Undated docs share one bucket. */
function yearKey(year: number | null): string {
  return year === null ? "undated" : String(year);
}

/** Sentinel for the year filter's "every year at once" option. */
const ALL_YEARS = "all";

function yearLabel(year: number | null): string {
  return year === null ? "Undated" : String(year);
}

/** Friendly labels for common tax form types */
const FORM_LABELS: Record<string, string> = {
  "1040": "Form 1040: Individual Tax Return",
  "1040-sr": "Form 1040-SR: Senior Tax Return",
  "w-2": "W-2: Wage & Tax Statement",
  "w2": "W-2: Wage & Tax Statement",
  "1099-misc": "1099-MISC: Miscellaneous Income",
  "1099-nec": "1099-NEC: Non-Employee Compensation",
  "1099-int": "1099-INT: Interest Income",
  "1099-div": "1099-DIV: Dividend Income",
  "1099-b": "1099-B: Proceeds from Broker",
  "1099-r": "1099-R: Retirement Distributions",
  "1099-g": "1099-G: Government Payments",
  "1099-k": "1099-K: Payment Card Transactions",
  "1099-sa": "1099-SA: HSA Distributions",
  "1098": "1098: Mortgage Interest",
  "1098-t": "1098-T: Tuition Statement",
  "1098-e": "1098-E: Student Loan Interest",
  "1120": "Form 1120: Corporate Tax Return",
  "1120s": "Form 1120S: S-Corp Tax Return",
  "1120-s": "Form 1120S: S-Corp Tax Return",
  "1065": "Form 1065: Partnership Return",
  "k-1": "Schedule K-1: Partner/Shareholder Income",
  "schedule k-1": "Schedule K-1: Partner/Shareholder Income",
  "5498": "5498: IRA Contribution Info",
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
    // Anchored to the start: unanchored, any 4-digit run in prose became the
    // row's bold title ("I paid 1200 for tax prep" → a row titled "1200").
    // Calendar years are excluded so "…for the 2025 tax year" isn't a label.
    /^\s*(?!19\d{2}|20\d{2})(\d{4}[A-Z]?(?:-[A-Z]+)?)\s+(?:\b(?:for|showing|tax)\b|[—–])/i,
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

/** What the API stores as the filename for the text-describe path. */
const MANUAL_ENTRY_FILENAME = "manual-entry";

/**
 * A typed description has no file behind it. The API's placeholder must never
 * reach the user, in a title, a row marker, a subtitle, or the group header.
 */
function hasRealFile(doc: { fileName: string }): boolean {
  return Boolean(doc.fileName) && doc.fileName !== MANUAL_ENTRY_FILENAME;
}

/**
 * `isFormName` says whether the label actually names a tax form. The subtitle's
 * opener strip assumes it does; running it against a filename-derived label
 * deleted the form identity from a typed description.
 */
function getDocLabel(doc: { llmFields?: Record<string, unknown> | null; llmSummary: string; fileName: string }): { label: string; formType: string | null; isFormName: boolean } {
  const rawType = extractFormType((doc.llmFields ?? {}) as Record<string, unknown>);
  if (rawType) {
    const key = rawType.toLowerCase().replace(/\s+/g, "").replace("form", "");
    const lookupKey = rawType.toLowerCase().trim();
    const friendly = FORM_LABELS[lookupKey] || FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: rawType.toUpperCase(), isFormName: true };
    return { label: rawType, formType: rawType.toUpperCase(), isFormName: true };
  }

  const summaryType = extractFormTypeFromSummary(doc.llmSummary);
  if (summaryType) {
    const key = summaryType.toLowerCase().trim();
    const friendly = FORM_LABELS[key];
    if (friendly) return { label: friendly, formType: summaryType.toUpperCase(), isFormName: true };
    return { label: summaryType, formType: summaryType.toUpperCase(), isFormName: true };
  }

  if (doc.llmSummary) {
    const firstSentence = doc.llmSummary.split(/[.!]\s/)[0];
    if (firstSentence && firstSentence.length < 80) {
      return { label: firstSentence, formType: null, isFormName: false };
    }
  }

  const nameNoExt = doc.fileName.replace(/\.[^.]+$/, "");
  // A typed description has no real file behind it, so the placeholder must
  // never surface as the row's title.
  if (!nameNoExt || nameNoExt === MANUAL_ENTRY_FILENAME) {
    return { label: "Typed description", formType: null, isFormName: false };
  }
  return { label: nameNoExt, formType: null, isFormName: false };
}

/**
 * The type badge only earns its place when the label doesn't already say it.
 * Both sides come from the same extracted field, so "Schedule 1" + "SCHEDULE 1"
 * is the normal case, not the exception.
 */
function badgeAddsInfo(label: string, formType: string | null): boolean {
  if (!formType) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !norm(label).includes(norm(formType));
}

/**
 * The row subtitle, or null when the summary only restates the label.
 *
 * Extraction summaries open by naming the form and year ("Schedule A for 2025
 * reporting total itemized deductions of …"), which the row label and the year
 * control above already say. Anchoring the strip on the label failed whenever
 * the summary worded the form differently ("VA Schedule A/CG" vs "Virginia
 * Schedule A/CG"), so match the "for <year> <verb>ing" clause instead.
 */
function summarySubtitle(summary: string, label: string, isFormName: boolean): string | null {
  let s = summary.trim();
  if (!s) return null;

  // The label check runs FIRST, against the untouched summary. When
  // getDocLabel had no form type and fell back to the summary's own first
  // sentence, stripping openers before this guard let the row print the same
  // sentence twice ("Shows total income of $5." / "Total income of $5.").
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.toLowerCase().startsWith(label.toLowerCase())) {
    s = s.slice(label.length).replace(/^[\s.,:;)\]\-\u2014\u2013]+/, "");
  } else if (norm(s).startsWith(norm(label))) {
    // Same words, different punctuation: a whole line saying nothing.
    return null;
  }
  if (!s) return null;

  // Then drop the opener, which comes in two shapes: "Schedule A for 2025
  // reporting …" and "Form 1040 for the 2025 tax year. Shows …". Only a short
  // form-name-shaped prefix may be consumed — an unconstrained `.{0,60}?`
  // matched a mid-sentence "…of wages for 2025 and …" and ate the employer and
  // the headline figure with it. A conjunction remainder means we matched the
  // wrong clause, so leave it alone.
  //
  // Skipped entirely when the label came from a filename or a typed paste: the
  // opener is then the only place the form is named, and eating it left a row
  // titled "manual-entry" with the form identity gone.
  if (!isFormName) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  s = s.replace(
    /^(?:[A-Za-z0-9][\w./()-]*[ ]){0,4}for\s+(?:the\s+)?(?:19|20)\d{2}(?:\s+tax\s+year)?\s*[.,]?\s+(?!and\b|or\b|but\b)/i,
    "",
  );
  s = s.replace(
    /^(?:show(?:s|ing)|report(?:s|ing)|claim(?:s|ing)|list(?:s|ing)|calculat(?:es|ing)|detail(?:s|ing))\s+/i,
    "",
  );

  // A bare year left over says nothing the year control doesn't.
  if (!s || /^(?:for\s+)?(?:the\s+)?(?:19|20)\d{2}[.\s]*$/i.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Middle-ellipsis. Two long filenames from one return differ only in their
 * tail, which is exactly the part a leading truncate eats, leaving both rows
 * rendering "2025-federal-and-state-tax-r…".
 */
function shortenMiddle(name: string, max = 34): string {
  if (name.length <= max) return name;
  const end = Math.ceil((max - 1) / 2);
  return `${name.slice(0, max - 1 - end)}…${name.slice(-end)}`;
}

function formatDocDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── types ───────────────────────────────────────────────────────────────────

interface Profile {
  filingStatus: string | null;
  annualIncome: number | null;
  stateOfResidence: string | null;
}

/** How the document list is ordered. Added-desc is the API's own order. */
type DocSort = "added-desc" | "added-asc" | "name-asc" | "name-desc";

/** Strategies shown before "Show more". Beyond this the documents section is
 *  pushed off the first screen, which is the other half of what this page is
 *  for. */
const STRATEGY_PREVIEW = 4;
/** One fewer on phones: four still pushed the documents heading behind the tab
 *  bar (y 824 vs a bar top of 773 at 390x844), which defeats the cap. */
const STRATEGY_PREVIEW_MOBILE = 3;

const DOC_SORT_OPTIONS: { value: DocSort; label: string }[] = [
  { value: "added-desc", label: "Newest added" },
  { value: "added-asc", label: "Oldest added" },
  { value: "name-asc", label: "Form name (A to Z)" },
  { value: "name-desc", label: "Form name (Z to A)" },
];

// ─── component ───────────────────────────────────────────────────────────────

export function TaxStrategy() {
  const [documents, setDocuments] = useState<TaxDocumentSummary[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  // The filing runs below wrap to a second row once the profile lands, so
  // the meta line has to reserve that row while the fetch is in flight.
  const [profileLoading, setProfileLoading] = useState(true);
  const [insightStatus, setInsightStatus] = useState<"idle" | "generating" | "done">("idle");
  const [selectedDoc, setSelectedDoc] = useState<TaxDocument | null>(null);
  const [docLoading, setDocLoading] = useState<string | null>(null);
  const [showSafety, setShowSafety] = useState(false);
  /** Popover opens upward when the trigger sits too low for the panel to fit. */
  const [safetyUp, setSafetyUp] = useState(false);
  /** Panel left edge, as an offset from the trigger's left edge. */
  const [safetyOffset, setSafetyOffset] = useState(0);
  const [safetyMax, setSafetyMax] = useState(340);
  const safetyBtnRef = useRef<HTMLButtonElement>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState(false);
  /** Plain-language description of what the uploaded documents show. */
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);
  const heroBodyRef = useRef<HTMLDivElement>(null);
  /** A retry is in flight, so focus needs catching if its button disappears. */
  const retryingRef = useRef(false);
  const docsErrorRef = useRef(false);
  docsErrorRef.current = docsError;
  const [selectedYearKey, setSelectedYearKey] = useState<string | null>(null);
  const [docSort, setDocSort] = useState<DocSort>("added-desc");
  const [showAllStrategies, setShowAllStrategies] = useState(false);
  const isMobile = useIsMobile();
  const strategyPreview = isMobile ? STRATEGY_PREVIEW_MOBILE : STRATEGY_PREVIEW;
  const safetyRef = useRef<HTMLDivElement>(null);
  const docsListRef = useRef<HTMLElement>(null);

  const { insights, isLoading: insightsLoading, reload, refresh, dismiss } = useInsights(TAX_INSIGHT_TYPE);
  const { setPageContext } = usePageContext();
  const confirm = useConfirm();
  const toast = useToast();

  /**
   * Measures the trigger and decides which corner the panel hangs from and how
   * tall it may be. Breakpoint guesses do not work here: the same control sits
   * at row-start in the documents toolbar and at row-end in the first-run hero,
   * so a fixed anchor clipped 46px off one of them at every width below 640.
   */
  const placeSafetyPanel = useCallback(() => {
    const el = safetyBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // The fixed bottom nav overlays the last ~68px on phones.
    const bottomInset = window.innerWidth < 640 ? 84 : 16;
    const below = window.innerHeight - r.bottom - bottomInset;
    const above = r.top - 16;
    const up = below < 260 && above > below;
    const panelW = Math.min(280, window.innerWidth - 32);

    // Line the panel up with the trigger's right edge, then clamp it into the
    // viewport. Picking a corner and hoping was not enough: at 320px the right
    // corner failed its fit check and the left corner, taken without any check
    // of its own, ran 46px off the other side and made the page scroll
    // sideways.
    let left = r.right - panelW;
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - 8 - panelW;
    if (left < 8) left = 8;

    setSafetyUp(up);
    setSafetyOffset(Math.round(left - r.left));
    setSafetyMax(Math.max(160, Math.min(340, up ? above : below)));
  }, []);

  // Geometry goes stale the moment the viewport changes, so it is recomputed
  // while the panel is open rather than only when it was clicked.
  useEffect(() => {
    if (!showSafety) return;
    const onResize = () => placeSafetyPanel();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [showSafety, placeSafetyPanel]);

  // Close safety popover on outside click or Escape.
  useEffect(() => {
    if (!showSafety) return;
    const onDown = (e: MouseEvent) => {
      if (safetyRef.current && !safetyRef.current.contains(e.target as Node)) {
        setShowSafety(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSafety(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showSafety]);

  useEffect(() => {
    loadDocuments();
    void loadSummary();
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
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, []);

  const loadDocuments = async () => {
    setDocsLoading(true);
    try {
      const { documents } = await api.getTaxDocuments();
      setDocuments(documents);
      setDocsError(false);
    } catch {
      setDocsError(true);
    } finally {
      setDocsLoading(false);
    }
  };

  /**
   * The summary is written server-side on first read after the documents
   * change, so this is a plain read that occasionally costs a generation. A
   * failed read keeps whatever was already on screen: a summary of documents
   * the user still has on file is better than an error.
   */
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const { summary, generatedAt } = await api.getTaxSummary();
      setSummary(summary);
      setSummaryGeneratedAt(generatedAt);
      setSummaryError(false);
    } catch {
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // "Updated" is news, not a status. Left alone it pinned a green badge in the
  // Actions header for the rest of the session, long after anything updated.
  useEffect(() => {
    if (insightStatus !== "done") return;
    const t = setTimeout(() => setInsightStatus("idle"), 6000);
    return () => clearTimeout(t);
  }, [insightStatus]);

  const retrySummary = useCallback(() => {
    retryingRef.current = true;
    void loadSummary();
  }, [loadSummary]);

  // A successful retry replaces the button the user just pressed with the
  // summary, dropping focus to <body> and sending a keyboard reader back to
  // the top of the page. Land them on the text they asked for instead. Same
  // rescue the document list does when a deleted row unmounts under focus.
  useEffect(() => {
    if (!retryingRef.current || summaryLoading) return;
    retryingRef.current = false;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        heroBodyRef.current?.focus({ preventScroll: true });
      }
    });
  }, [summaryLoading]);

  // Insight generation happens server-side after a document lands, with no
  // completion signal to subscribe to. Poll for a bounded window instead of
  // guessing a fixed delay, so "Updated" only ever means insights changed.
  const insightIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    insightIdsRef.current = new Set(insights.map((i) => i.id));
  }, [insights]);

  const awaitNewInsights = useCallback(async () => {
    const before = insightIdsRef.current;
    setInsightStatus("generating");
    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const data = await api.getInsights();
        // Compare like with like. `insightIdsRef` holds the tax-filtered ids,
        // so testing them against the unfiltered response made every non-tax
        // insight look new and flipped the badge to "Updated" immediately.
        const tax = data.insights.filter((i) => (i.type ?? "general") === TAX_INSIGHT_TYPE);
        if (tax.some((i) => !before.has(i.id))) {
          await reload();
          setInsightStatus("done");
          return;
        }
      } catch {
        // transient — keep polling until the window closes
      }
    }
    await reload().catch(() => {});
    setInsightStatus("idle");
  }, [reload]);

  /** One extracted document landed. Show its row straight away. */
  const handleDocumentAdded = useCallback((doc: TaxInputResult) => {
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
  }, []);

  /**
   * The whole batch finished. Switching the visible year mid-batch emptied the
   * list under the user, so it happens once, here, and only when every new
   * document agrees on a year.
   */
  const handleBatchSettled = useCallback(
    (added: TaxInputResult[]) => {
      if (added.length === 0) return;
      const years = new Set(added.map((d) => yearKey(d.taxYear ?? null)));
      if (years.size === 1) setSelectedYearKey([...years][0]);
      // The list failed to load earlier but the upload just succeeded, so the
      // API is reachable again. Without this the new document lands in state
      // behind the error Alert and the save looks lost.
      if (docsErrorRef.current) void loadDocuments();
      void loadSummary();
      void awaitNewInsights();
    },
    [awaitNewInsights, loadSummary]
  );

  const handleDeleteDocument = useCallback(
    async (doc: TaxDocumentSummary) => {
      const { label } = getDocLabel(doc);
      const ok = await confirm({
        title: `Delete ${label}?`,
        body: "The extracted fields are removed and the strategies built from them are recalculated. The original file was never stored, so this cannot be undone.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      try {
        await api.deleteTaxDocument(doc.id);
        setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
        if (selectedDoc?.id === doc.id) setSelectedDoc(null);
        // The dialog restores focus to the row's own Delete button, but that
        // button unmounts a tick later when this row disappears, dropping
        // focus to <body>. Land on the list so Tab continues from the content.
        requestAnimationFrame(() => docsListRef.current?.focus({ preventScroll: true }));
        void loadSummary();
        void awaitNewInsights();
      } catch {
        toast({
          tone: "negative",
          title: `Could not delete ${label}`,
          description: "Nothing was removed. Check your connection and try again.",
        });
      }
    },
    [selectedDoc, confirm, toast, awaitNewInsights, loadSummary]
  );

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
      await Promise.all([refresh(), loadSummary()]);
    } finally {
      setRefreshingInsights(false);
    }
  }, [refresh, loadSummary]);

  const filingLabel = profile?.filingStatus
    ? FILING_LABELS[profile.filingStatus] ?? profile.filingStatus
    : null;

  // Group the flat document list into per-year sections — numeric years newest
  // first, the undated bucket last. Docs keep the API's desc(createdAt) order.
  const documentsByYear = useMemo<{ year: number | null; docs: TaxDocumentSummary[] }[]>(() => {
    const byYear = new Map<number | null, TaxDocumentSummary[]>();
    for (const doc of documents) {
      const key = doc.taxYear ?? null;
      const bucket = byYear.get(key);
      if (bucket) bucket.push(doc);
      else byYear.set(key, [doc]);
    }
    return [...byYear.entries()]
      .map(([year, docs]) => ({ year, docs }))
      .sort((a, b) => {
        if (a.year === null) return 1;
        if (b.year === null) return -1;
        return b.year - a.year;
      });
  }, [documents]);

  // The year on screen. Derived rather than stored, so deleting the last
  // document of a year falls back to the newest group instead of stranding
  // the user on one that no longer exists.
  const activeYearKey = useMemo(() => {
    if (documentsByYear.length === 0) return null;
    if (selectedYearKey === ALL_YEARS) return ALL_YEARS;
    if (selectedYearKey && documentsByYear.some((g) => yearKey(g.year) === selectedYearKey)) {
      return selectedYearKey;
    }
    // Default to every year rather than the newest: a user who has just been
    // asked "which year?" should see what there is before narrowing.
    return documentsByYear.length > 1 ? ALL_YEARS : yearKey(documentsByYear[0].year);
  }, [documentsByYear, selectedYearKey]);

  const visibleDocs = useMemo(() => {
    if (activeYearKey === ALL_YEARS) return documents;
    return documentsByYear.find((g) => yearKey(g.year) === activeYearKey)?.docs ?? [];
  }, [activeYearKey, documents, documentsByYear]);

  const sortedDocs = useMemo(() => {
    const docs = [...visibleDocs];
    const added = (d: TaxDocumentSummary) => (d.createdAt ? new Date(d.createdAt).getTime() : 0);
    const name = (d: TaxDocumentSummary) => getDocLabel(d).label.toLowerCase();
    switch (docSort) {
      case "added-asc":
        return docs.sort((a, b) => added(a) - added(b));
      case "name-asc":
        return docs.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
      case "name-desc":
        return docs.sort((a, b) => name(b).localeCompare(name(a), undefined, { numeric: true }));
      default:
        return docs.sort((a, b) => added(b) - added(a));
    }
  }, [visibleDocs, docSort]);

  /**
   * A return uploaded as one PDF gives every row the same filename and the same
   * added date. Repeating them 20 times says nothing, so the dominant value is
   * stated once in the section header and dropped from the rows that match it.
   * Rows that differ keep theirs, which is what makes the odd one out visible.
   */
  const rowNoise = useMemo(() => {
    if (sortedDocs.length < 2) return { name: null, date: null, total: sortedDocs.length };
    const mode = (values: string[]) => {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      let value = "";
      let count = 0;
      for (const [v, c] of counts) if (c > count) [value, count] = [v, c];
      return { value, count };
    };
    // Below this it isn't a shared default, it's just the first of many.
    const floor = Math.max(2, Math.ceil(sortedDocs.length * 0.6));
    const realNames = sortedDocs.filter(hasRealFile).map((d) => d.fileName);
    const name = realNames.length > 0 ? mode(realNames) : { value: "", count: 0 };
    const date = mode(sortedDocs.map((d) => (d.createdAt ? formatDocDate(d.createdAt) : "")));
    return {
      name: name.value && name.count >= floor ? name : null,
      date: date.value && date.count >= floor ? date : null,
      total: sortedDocs.length,
    };
  }, [sortedDocs]);

  /**
   * Per-row extras, keyed by document id.
   *
   * `marker` is the row's exception line. It appears only when the row
   * contradicts what the section header claims about the group ("19 of 20 from
   * tax_return.pdf, added Apr 25, 2026"), or when the row shares a label with
   * another visible row and needs the differing token to be tellable apart.
   * Everything else leans on the summary, which says more than a filename does.
   *
   * `date` is the right-hand column, used only when there is no group date
   * claim for a row to contradict.
   */
  const rowMeta = useMemo(() => {
    const dateOf = (d: TaxDocumentSummary) => (d.createdAt ? formatDocDate(d.createdAt) : null);
    const byLabel = new Map<string, TaxDocumentSummary[]>();
    for (const doc of sortedDocs) {
      const { label } = getDocLabel(doc);
      const peers = byLabel.get(label);
      if (peers) peers.push(doc);
      else byLabel.set(label, [doc]);
    }

    const out = new Map<
      string,
      { marker: string | null; date: string | null; nameIsRedundant: boolean; year: string | null }
    >();
    // With every year on screen at once the tax year is what separates one
    // Schedule A from the next, so each row carries its own.
    const mixedYears = activeYearKey === ALL_YEARS && documentsByYear.length > 1;
    for (const doc of sortedDocs) {
      const { label } = getDocLabel(doc);
      const peers = byLabel.get(label) ?? [doc];
      const docDate = dateOf(doc);
      const nameUseful = hasRealFile(doc) && doc.fileName.replace(/\.[^.]+$/, "") !== label;

      let showFile = nameUseful && rowNoise.name !== null && doc.fileName !== rowNoise.name.value;
      let showDate = rowNoise.date !== null && docDate !== rowNoise.date.value;

      // Same label as another row: surface whichever token actually separates
      // them. When neither does, the summaries already differ, so adding a
      // filename both rows share would only echo the header. The date is only
      // worth adding when the right-hand column isn't already printing it.
      const yearsSeparatePeers =
        mixedYears && new Set(peers.map((p) => p.taxYear ?? null)).size > 1;
      if (peers.length > 1 && !yearsSeparatePeers) {
        if (nameUseful && new Set(peers.filter(hasRealFile).map((p) => p.fileName)).size > 1) {
          showFile = true;
        }
        // Only when the right-hand date column is off, since that column is
        // hidden below sm. With a group date claim in place the header rule
        // above already marks exactly the rows that deviate, and adding a date
        // to the rows that match would just echo the header back.
        if (rowNoise.date === null && new Set(peers.map(dateOf)).size > 1) showDate = true;
      }

      const parts = [
        showFile ? `from ${shortenMiddle(doc.fileName)}` : null,
        showDate && docDate ? `added ${docDate}` : null,
      ].filter(Boolean);

      out.set(doc.id, {
        marker: parts.length > 0 ? parts.join(", ") : null,
        // Suppressed when the marker took it, and in all-years mode where the
        // year badge is the right-hand element: a variable-width date beside it
        // left the badges visibly ragged and sat an unlabelled "2025" next to
        // an "Added ... 2026".
        date: mixedYears || showDate || rowNoise.date !== null ? null : docDate,
        year: mixedYears ? yearLabel(doc.taxYear ?? null) : null,
        // A document with no usable summary falls back to its filename as the
        // subtitle. Suppress that when the marker already prints the name, or
        // when it is the very name the section header states for the group.
        nameIsRedundant:
          !hasRealFile(doc) ||
          showFile ||
          (rowNoise.name !== null && doc.fileName === rowNoise.name.value),
      });
    }
    return out;
  }, [sortedDocs, rowNoise, activeYearKey, documentsByYear.length]);

  const rowNoiseSummary = useMemo(() => {
    const { name, date, total } = rowNoise;
    if (!name && !date) return null;
    // Intersection, not min(): with 6 sharing a name and 6 sharing a date but
    // only 3 sharing both, min() claimed 6 while 7 rows contradicted it.
    const count = sortedDocs.filter(
      (d) =>
        (!name || d.fileName === name.value) &&
        (!date || (d.createdAt ? formatDocDate(d.createdAt) : "") === date.value),
    ).length;
    const lead = count === total ? `All ${total}` : `${count} of ${total}`;
    const parts = [name && `from ${name.value}`, date && `added ${date.value}`].filter(Boolean);
    return `${lead} ${parts.join(", ")}`;
  }, [rowNoise]);

  const handleYearChange = useCallback((key: string) => {
    setSelectedYearKey(key);
    // A detail row or a pending delete confirm belongs to the year it was
    // opened in, not the one being switched to.
    setSelectedDoc(null);
  }, []);

  useEffect(() => {
    if (profile) {
      setPageContext({
        pageId: "tax",
        pageTitle: "Tax Strategy",
        description: "What the user's uploaded tax documents show, plus the actions on file.",
      });
    }
  }, [profile, setPageContext]);

  const showUpload = import.meta.env.VITE_DEMO_MODE !== "true";

  // "Updating"/"Updated" is about the ACTIONS, so it lives in their header, not
  // in the hero (which describes the situation, not the actions) and not in the
  // documents toolbar where it ended up after the restructure.
  const insightStatusBadge =
    insightStatus === "generating" ? (
      <Badge tone="caution" size="sm">
        <RefreshCw size={11} className="animate-spin" />
        Updating
      </Badge>
    ) : insightStatus === "done" ? (
      <Badge tone="positive" size="sm">Updated</Badge>
    ) : null;

  const privacyControl = (
    <>
      <div className="relative" ref={safetyRef}>
        {/* Labelled: an unlabelled shield floating at the end of a rule reads as
            an orphan, and a title attribute is invisible on touch. */}
        <button
          ref={safetyBtnRef}
          type="button"
          onClick={() => {
            placeSafetyPanel();
            setShowSafety((p) => !p);
          }}
          aria-expanded={showSafety}
          aria-haspopup="dialog"
          className="touch-target ui-focus inline-flex h-9 items-center gap-1.5 rounded-ui-md border border-line px-2.5 text-[12.5px] font-semibold text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
        >
          <ShieldCheck size={14} />
          How is my data kept safe?
        </button>
        {showSafety && (
          // Position comes from placeSafetyPanel(), which measures. A
          // breakpoint guess is not enough: this same control sits at row-start
          // in the documents toolbar and at row-end in the first-run hero, so
          // any fixed anchor clips at one of the two call sites.
          <div
            role="dialog"
            aria-label="How your data is kept safe"
            className={cn(
              "animate-scale-in absolute z-50 w-[min(280px,calc(100vw-2rem))] overflow-y-auto rounded-ui-lg border border-line-strong bg-panel-raised p-4 text-left shadow-ui-lg",
              safetyUp
                ? "bottom-[calc(100%+8px)] origin-bottom"
                : "top-[calc(100%+8px)] origin-top",
            )}
            style={{ left: safetyOffset, maxHeight: safetyMax }}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <ShieldCheck size={14} className="shrink-0 text-positive" />
              <span className="text-[13px] font-bold text-content">What happens to a document you upload</span>
              <button
                type="button"
                onClick={() => setShowSafety(false)}
                className="touch-target ui-focus -mr-1 ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {[
                "An AI model reads it automatically. No person at Lasagna opens what you upload.",
                "It takes the figures your strategies are built from, like wages, withholding, and deductions.",
                "Names, addresses, Social Security and account numbers are stripped out before the figures are saved.",
                "The document itself is never stored, and deleting it removes the figures too.",
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
    </>
  );

  const hasDocs = documents.length > 0;
  /**
   * ONE derived state for the hero. The summary and the document list are two
   * independent fetches, and gating them separately made a single page load
   * flash three different sentences on the way to the answer.
   *
   * Order is the point. A summary that is already on screen outranks a failed
   * document list, because it still describes documents the user has, and it
   * outranks its own refetch too: pressing Refresh must not blank the card it
   * is not refreshing, and it does not blank the retry button either: the
   * skeleton unmounting mid-retry threw keyboard focus back to <body>. Loading
   * therefore only wins when the card has nothing on it yet. Below that,
   * `insights.length` matters on its own: the tax lens in the insights engine
   * is not document-gated, so a user can genuinely have actions and no
   * uploaded documents, and was being shown the upload pitch instead.
   */
  const heroState = docsLoading || (hasDocs && summaryLoading && !summary && !summaryError)
    ? "loading"
    : summary
      ? "summary"
      : summaryError
        ? "summary-failed"
        : docsError
          ? "docs-error"
          : hasDocs
            ? "no-summary"
            : insights.length > 0
              ? "account-data"
              : "first-run";

  /** The hero, the Actions header and the Actions list are one section. */
  const showStrategyZone = heroState !== "first-run";

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
      <header>
        <h1 className="font-editorial text-[26px] sm:text-[34px] font-bold leading-[1.04] tracking-[-0.028em] text-content">
          Tax
        </h1>
      </header>

      {/* ══════════ ZONE 1 — Where do I stand? ══════════ */}

      {/* ── HERO — what the documents on file actually say ── */}
      <section
        data-hero
        className="relative mt-6 sm:mt-7 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-8"
      >
        {/* The wash is rounded to the card instead of the card clipping it, so
            the upload area's popover can open past the hero's edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-ui-xl"
          style={{
            background:
              "radial-gradient(92% 82% at 0% 0%, var(--ui-brand-softer), transparent 60%)," +
              "radial-gradient(84% 74% at 100% 0%, var(--ui-accent-softer), transparent 62%)",
          }}
        />
        {/* One column. The old right-hand "Where it comes from" panel listed the
            same strategies rendered in full 600px below, so it read as the page
            repeating itself rather than as a second view of the data. */}
        <div className="relative min-w-0 max-w-[62ch]">
          {showStrategyZone ? (
            <>
              {/* Constant string. Swapping the headline between loading and
                  loaded states meant reserving its height per breakpoint, and
                  the reservation was wrong wherever the 62ch column wrapped
                  differently (40px at 768, 16px at 834). A headline that never
                  changes cannot shift, at any width. */}
              <h2 className="font-editorial text-[28px] sm:text-[38px] font-extrabold leading-[1.04] tracking-[-0.028em] text-content">
                Your tax situation
              </h2>
              <div ref={heroBodyRef} tabIndex={-1} className="ui-focus mt-3.5 rounded-ui-md">
                {heroState === "summary" ? (
                  <>
                    {/* No live region on the prose: re-reading 400 characters
                        on every load and every Refresh is noise, and this is
                        the card's main content, which a reader reaches anyway. */}
                    <div className="space-y-2.5">
                      {splitParagraphs(summary ?? "").map((para, i) => (
                        <p key={i} className="text-[15px] leading-[1.6] text-content-secondary">
                          {para}
                        </p>
                      ))}
                    </div>
                    {/* Only ever shown beside a summary. "Updated" with nothing
                        updated beneath it says nothing. */}
                    {summaryGeneratedAt && (
                      <p className="mt-3">
                        <TimeStamp iso={summaryGeneratedAt} />
                      </p>
                    )}
                  </>
                ) : (
                  <div aria-live="polite">
                    {heroState === "loading" ? (
                      <SkeletonText lines={3} />
                    ) : heroState === "summary-failed" ? (
                      <>
                        <p className="text-[15px] leading-[1.6] text-content-secondary">
                          We could not load your summary.
                        </p>
                        {/* The same control the documents error below uses, so
                            one word does not mean two different affordances.
                            Deliberately NOT `loading`: that prop disables the
                            button, and disabling the focused element blurs it,
                            which is the very thing this is avoiding. The icon
                            carries the progress instead. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-3"
                          aria-busy={summaryLoading || undefined}
                          leadingIcon={
                            <RefreshCw size={14} className={summaryLoading ? "animate-spin" : ""} />
                          }
                          onClick={retrySummary}
                        >
                          {summaryLoading ? "Retrying…" : "Try again"}
                        </Button>
                      </>
                    ) : (
                      /* The three one-line states share a fixed reserve. They
                         wrap to different line counts at different column
                         widths, so a per-breakpoint min-height never converged:
                         fixing 768 broke 834. The longest of them is rendered
                         invisibly to reserve its exact height, and the visible
                         one is laid over it, so swapping between them cannot
                         move the card. The summary, loading and failed states
                         are deliberately NOT in here: prose of two to four
                         sentences would clip, and a button would break the
                         height guarantee. */
                      <p className="relative text-[15px] leading-[1.55] text-content-secondary">
                        {/* All three are kept short enough to sit on ONE line
                            down to 375, so the reserve costs no dead line under
                            the sentence at the widths most people are on. */}
                        <span className="invisible" aria-hidden>
                          Actions below come from your accounts.
                        </span>
                        <span className="absolute inset-0">
                          {heroState === "docs-error" ? (
                            /* Says what the HERO lost, not what failed. The
                               documents section states the failure beside its
                               own retry, and repeating its exact sentence up
                               here put the same words on screen twice. */
                            <>No summary until your documents load.</>
                          ) : heroState === "no-summary" ? (
                            <>A summary is not available right now.</>
                          ) : (
                            <>Actions below come from your accounts.</>
                          )}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Filing context. These are facts, not state, so they read as
                  text: as plain runs there is room for the full filing label,
                  which is why the abbreviation and its tooltip are gone. */}
              <PageMeta className="mt-5">
                {profileLoading ? (
                  <PageMetaSkeleton widths={['w-[151px]', 'w-[19px]', 'w-[97px]']} />
                ) : (
                  <>
                    {filingLabel && (
                      <PageMetaItem className="inline-flex items-center gap-1.5">
                        <Receipt className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {filingLabel}
                      </PageMetaItem>
                    )}
                    {profile?.stateOfResidence && (
                      <PageMetaItem>{profile.stateOfResidence}</PageMetaItem>
                    )}
                    <PageMetaItem className="ui-tnum">{FILING_YEAR} filing year</PageMetaItem>
                  </>
                )}
              </PageMeta>
            </>
          ) : (
            <>
              {/* Same headline as the loaded branch. While the document fetch
                  is in flight we cannot know which branch a user lands on, and
                  a different string here made a first-time visitor watch the
                  headline swap under them. The invitation lives in the
                  sentence, which is allowed to differ. */}
              <h2 className="font-editorial text-[28px] sm:text-[38px] font-extrabold leading-[1.04] tracking-[-0.028em] text-content">
                Your tax situation
              </h2>
              <p className="mt-3.5 text-[15px] leading-[1.55] text-content-secondary">
                Add your W-2s, 1099s, or any tax form. We read the figures, describe what they show, and
                never store the original file.
              </p>
            </>
          )}
        </div>

        {/* First run only. Once documents exist the dropzone belongs with them,
            not wedged between the headline and the actions it introduces. */}
        {showUpload && !showStrategyZone && (
          <div className="tax-input-wrap mt-6 sm:mt-7">
            <div className="mb-4 flex items-center justify-end gap-3">
              <div className="hidden h-px flex-1 bg-line sm:block" />
              <div className="flex shrink-0 items-center gap-2">{privacyControl}</div>
            </div>
            <TaxInputPanel onDocument={handleDocumentAdded} onBatchSettled={handleBatchSettled} />
          </div>
        )}
      </section>

      {/* The four-up stat strip that used to sit here restated the filing
          status, document count, action count and filing year, every one of
          which the page already shows within 400px. */}

      {/* ── Actions — the concrete moves ── */}
      {/* Its own header. The hero above describes the situation, so it can no
          longer double as this list's heading, and the list was left with
          nothing naming it. "Actions" because that is what this same data is
          called on /insights and in PageActions. */}
      {!showStrategyZone ? null : insightsLoading ? (
        // Mirrors the loaded shape, header included: without the header
        // placeholder the h2 and Refresh popped in and shoved the list down 16px.
        <section className="mt-7 sm:mt-14" aria-hidden>
          {/* Same wrapper classes as the real header row, so the heading and
              the Refresh button both land where their placeholders sat. */}
          <div className="flex items-end justify-between gap-3 px-1 pb-3.5">
            <Skeleton className="h-[26px] w-32" />
            {/* Wears `touch-target` for the same reason the real Refresh
                button does, so it grows to 44px on exactly the widths and
                pointers that grow the button. Guessing the breakpoint instead
                left an 8px drop at 640, where max-width:640 and Tailwind's
                min-width:640 both apply. */}
            <Skeleton className="touch-target h-9 w-[99px] rounded-ui-md" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-2.5 shadow-ui-sm"
              >
                <Skeleton className="h-6 w-6 shrink-0 rounded-ui-md" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-[22px] w-32 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="mt-7 sm:mt-14">
          {/* Wraps rather than overflows: at 320 the count, the "Updating"
              badge and Refresh together are wider than the row, and an
              unwrapped row made the whole page scroll sideways. */}
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-1 pb-3.5">
            <h2 className="font-editorial text-[21px] sm:text-[23px] font-bold tracking-[-0.02em]">
              Actions
            </h2>
            {/* Beside the actions, not the hero: next to a description of the
                situation Refresh reads as "refresh the summary", which is not
                what it does. The count sits here in the same words and the same
                place as "N documents" on the sibling header below, rather than
                as a bare digit beside the heading. */}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Suppressed at zero: the empty state directly below already
                  says there are none. */}
              {insights.length > 0 && (
                <span className="text-[13px] font-semibold text-content-muted ui-tnum">
                  {insights.length} {insights.length === 1 ? "action" : "actions"}
                </span>
              )}
              {insightStatusBadge}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshInsights}
                disabled={refreshingInsights || insightsLoading}
                leadingIcon={<RefreshCw size={15} className={refreshingInsights ? "animate-spin" : ""} />}
              >
                {refreshingInsights ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>
          {insights.length > 0 ? (
            <div className="flex flex-col gap-2">
              {(showAllStrategies ? insights : insights.slice(0, strategyPreview)).map((ins) => (
                <ActionItem
                  key={ins.id}
                  title={ins.title}
                  tag={(ins.type ?? ins.category ?? 'tax').toUpperCase()}
                  description={ins.description}
                  impact={ins.impact ?? ''}
                  impactColor={(ins.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
                  chatPrompt={ins.chatPrompt ?? ins.title}
                  onDismiss={() => dismiss(ins.id)}
                />
              ))}
              {insights.length > strategyPreview && (
                <button
                  type="button"
                  onClick={() => setShowAllStrategies((v) => !v)}
                  aria-expanded={showAllStrategies}
                  className="touch-target ui-focus mt-1 inline-flex items-center justify-center gap-1.5 self-start rounded-ui-md px-2 py-1.5 text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] transition-colors hover:bg-brand-softer"
                >
                  {showAllStrategies
                    ? "Show fewer"
                    : `Show ${insights.length - strategyPreview} more`}
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className={cn("transition-transform", showAllStrategies ? "-rotate-90" : "rotate-90")}
                  />
                </button>
              )}
            </div>
          ) : (
            // Rendered rather than skipped: the Refresh button beside the
            // heading has to refer to something on screen.
            <EmptyState
              tone="brand"
              icon={<Receipt size={24} />}
              title="No actions right now"
              description="Nothing on file needs a decision from you. Add a document and this list updates."
            />
          )}
        </section>
      )}

      {/* ══════════ ZONE 2 — What have I got on file? ══════════ */}
      {/* A first-run user with the dropzone live on screen does not need a
          240px dashed box 600px below it announcing they have no documents.
          In demo mode, where there is no dropzone, the empty state explains
          what would appear here. */}
      {(hasDocs || docsLoading || docsError || !showUpload || insights.length > 0) && (
      <section className="mt-7 sm:mt-14">
        <div className="flex items-end justify-between gap-3 px-1 pb-3.5">
          <h2 className="font-editorial text-[21px] sm:text-[23px] font-bold tracking-[-0.02em]">
            Your documents
          </h2>
          {/* Counts the whole library, and names the slice when one is applied.
              "6 documents" alone read as the total while 15 more sat in other
              years. */}
          {/* No count until there is one to give: this rendered "0 documents"
              directly above "We could not load your documents." */}
          {/* Also suppressed at zero: the empty state directly below already
              says there are none, so "0 documents" only repeats it. */}
          {!docsLoading && !docsError && documents.length > 0 && (
            <span className="shrink-0 text-[13px] font-semibold text-content-muted ui-tnum">
              {activeYearKey === ALL_YEARS || documentsByYear.length <= 1
                ? `${documents.length} ${documents.length === 1 ? "document" : "documents"}`
                : `${visibleDocs.length} of ${documents.length}`}
            </span>
          )}
        </div>

        {/* One toolbar. Year and Sort were two controls on two rows, and the
            year row was an unlabelled strip of numbers that never said it was a
            filter, never said what was in each year, and scrolled off-screen at
            390px. Both are now labelled Selects that scale to any number of
            years. */}
        {(documentsByYear.length > 1 ||
          visibleDocs.length > 1 ||
          (showUpload && (hasDocs || docsError || insights.length > 0))) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 pb-3.5">
            {documentsByYear.length > 1 && (
              <label className="flex w-full items-center gap-2 text-[13px] text-content-muted sm:w-auto sm:shrink-0">
                Year
                <span className="min-w-0 flex-1 sm:flex-none sm:w-[168px]">
                <Select
                  aria-label="Filing year"
                  value={activeYearKey ?? ALL_YEARS}
                  onChange={(e) => handleYearChange(e.target.value)}
                  className="w-full text-[13px]"
                >
                  <option value={ALL_YEARS}>All years ({documents.length})</option>
                  {documentsByYear.map((g) => (
                    <option key={yearKey(g.year)} value={yearKey(g.year)}>
                      {yearLabel(g.year)} ({g.docs.length})
                    </option>
                  ))}
                </Select>
                </span>
              </label>
            )}
            {visibleDocs.length > 1 && (
              <label className="flex w-full items-center gap-2 text-[13px] text-content-muted sm:w-auto sm:shrink-0">
                Sort
                <span className="min-w-0 flex-1 sm:flex-none sm:w-[190px]">
                <Select
                  aria-label="Sort documents"
                  value={docSort}
                  onChange={(e) => setDocSort(e.target.value as DocSort)}
                  className="w-full text-[13px]"
                >
                  {DOC_SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
                </span>
              </label>
            )}
            {showUpload && (hasDocs || docsError || insights.length > 0) && (
              <div className="flex shrink-0 items-center gap-2 sm:ml-auto">{privacyControl}</div>
            )}
          </div>
        )}

        {/* The dropzone lives with the documents it adds to. */}
        {showUpload && (hasDocs || docsError || insights.length > 0) && (
          <div className="tax-input-wrap pb-4">
            <TaxInputPanel onDocument={handleDocumentAdded} onBatchSettled={handleBatchSettled} />
          </div>
        )}

        {/* Sits directly above the list it describes. */}
        {rowNoiseSummary && sortedDocs.length > 1 && (
          <p
            className="truncate pb-2 text-right text-[13px] text-content-muted"
            title={rowNoiseSummary}
          >
            {rowNoiseSummary}
          </p>
        )}

        {docsLoading ? (
          <div className="overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm" aria-hidden>
            {[0, 1, 2].map((i) => (
              // Approximates the loaded row box.
              <div
                key={i}
                className="m-1 flex items-center gap-3.5 border-t border-line py-2.5 pl-3 pr-2 first:border-t-0 sm:pl-4"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-ui-md" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="mt-1.5 h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : docsError ? (
          <Alert
            tone="negative"
            title="We could not load your documents."
            action={
              <Button variant="secondary" size="sm" onClick={loadDocuments}>
                Try again
              </Button>
            }
          />
        ) : sortedDocs.length > 0 ? (
          <section
            ref={docsListRef}
            tabIndex={-1}
            className="ui-focus overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm"
          >
            {sortedDocs.map((doc) => (
              <Fragment key={doc.id}>
                <DocRow
                  doc={doc}
                  selected={selectedDoc?.id === doc.id}
                  loading={docLoading === doc.id}
                  showDelete={showUpload}
                  meta={rowMeta.get(doc.id) ?? { marker: null, date: null, nameIsRedundant: false, year: null }}
                  onSelect={() => handleSelectDocument(doc.id)}
                  onDelete={() => handleDeleteDocument(doc)}
                />
                {/* Detail expands inline right under the tapped row — reachable
                    on every viewport, never buried below the full list. */}
                <AnimatePresence initial={false}>
                  {selectedDoc?.id === doc.id && (
                    <motion.div
                      key={`${doc.id}-detail`}
                      id={`doc-detail-${doc.id}`}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden border-t border-line bg-canvas-sunken/40"
                    >
                      <DocumentDetail
                        doc={selectedDoc}
                        // The row's exception line already prints the filename.
                        showFileName={!rowMeta.get(doc.id)?.marker}
                        onClose={() => setSelectedDoc(null)}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </Fragment>
            ))}
          </section>
        ) : (
          // Only when there is no dropzone. With one on screen this rendered a
          // second dashed box in the dropzone's own idiom, directly beneath it,
          // saying nothing the heading and dropzone had not already said.
          !showUpload ? (
            <EmptyState
              icon={<FolderOpen size={24} />}
              title="No documents yet"
              description="Uploaded tax forms and their extracted fields will show up here."
            />
          ) : null
        )}
      </section>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

/**
 * Document list row. The type badge and the filename used to sit here beside
 * the label, but both are derived from it: "Schedule 1" came with a badge
 * reading "SCHEDULE 1", and every row of a single uploaded return carried the
 * same filename. Each secondary element now renders only when it differs from
 * what the label already says.
 */
function DocRow({
  doc,
  selected,
  loading,
  showDelete,
  meta,
  onSelect,
  onDelete,
}: {
  doc: TaxDocumentSummary;
  selected: boolean;
  loading: boolean;
  showDelete: boolean;
  /** Exception line and right-hand date, decided for the whole group upstream. */
  meta: { marker: string | null; date: string | null; nameIsRedundant: boolean; year: string | null };
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { label, formType, isFormName } = getDocLabel(doc);
  const showBadge = badgeAddsInfo(label, formType);
  // Compare without the extension: the label is the filename minus ".pdf", so
  // a plain equality test let an untyped scan print its own name twice.
  const nameNoExt = doc.fileName.replace(/\.[^.]+$/, "");

  // With the badge, filename and date all stripped, most rows were a single
  // label against ~1,100px of empty. The extraction summary is already loaded
  // and is the only line that says something the label doesn't, so it owns the
  // subtitle. The filename is the fallback for a document with no summary, and
  // `meta.marker` carries it separately when the row is an exception.
  const summaryLine = summarySubtitle(doc.llmSummary?.trim() ?? "", label, isFormName);
  const subtitle =
    summaryLine ?? (nameNoExt !== label && !meta.nameIsRedundant ? doc.fileName : null);

  return (
    <div
      className={cn(
        "group flex items-stretch border-t border-line transition-colors first:border-t-0",
        selected ? "bg-brand-soft" : "hover:bg-brand-softer",
      )}
    >
      {/* A real button, so the delete control is a sibling rather than a
          focusable descendant of a role="button". */}
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        aria-controls={`doc-detail-${doc.id}`}
        // Inset so the focus ring has room: the card clips overflow, and a
        // full-bleed button lost the ring's left edge.
        className="ui-focus m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 rounded-ui-md py-2.5 pl-3 pr-2 text-left sm:pl-4"
      >
        <span
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-ui-md transition-colors",
            selected ? "bg-brand text-brand-fg" : "bg-canvas-sunken text-content-secondary",
          )}
        >
          <FileText size={16} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold leading-tight text-content" title={label}>
            {label}
          </span>
          {subtitle && (
            <span className="mt-0.5 block truncate text-[12.5px] text-content-secondary" title={subtitle}>
              {subtitle}
            </span>
          )}
          {/* Below sm the year badge would eat 58px of a 200px title, so the
              year rides in the text column instead. */}
          {meta.year && (
            <span className="mt-1 block text-[12px] font-semibold text-content-muted ui-tnum sm:hidden">
              {meta.year === "Undated" ? "Undated" : `Tax year ${meta.year}`}
            </span>
          )}
          {/* The exception line. A plain line rather than a desktop-only column,
              so the one row that differs is still identifiable at 390px. */}
          {meta.marker && (
            <span
              className="mt-1 block truncate text-[12px] font-medium text-content-muted"
              title={doc.fileName}
            >
              {meta.marker}
            </span>
          )}
        </span>

        {meta.year ? (
          <Badge
            tone="neutral"
            size="sm"
            className="hidden shrink-0 ui-tnum sm:inline-flex"
            title={`Tax year ${meta.year}`}
          >
            {meta.year}
          </Badge>
        ) : showBadge ? (
          <Badge tone="neutral" size="sm" className="hidden shrink-0 sm:inline-flex">
            {formType}
          </Badge>
        ) : null}
        {meta.date && (
          <span className="hidden shrink-0 text-[13px] font-medium text-content-muted ui-tnum sm:block">
            Added {meta.date}
          </span>
        )}

        {loading ? (
          <RefreshCw size={16} className="shrink-0 animate-spin text-content-muted" />
        ) : (
          // The open action had no affordance at all, which left the trash icon
          // as the only thing on the row that looked clickable.
          <ChevronRight
            size={16}
            aria-hidden
            className={cn(
              "shrink-0 text-content-faint transition-transform",
              selected && "rotate-90 text-brand",
            )}
          />
        )}
      </button>

      {showDelete && (
        // Revealed on hover or keyboard focus where a hover pointer exists.
        // Twenty trash cans at the same weight as the open chevron made the
        // destructive action the most prominent thing in the list. `hover-reveal`
        // keys off the pointer, not the width: the previous `sm:` guard left an
        // invisible but tappable delete button on every tablet row.
        <button
          type="button"
          onClick={onDelete}
          className="hover-reveal touch-target ui-focus my-auto mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-ui-md text-content-faint transition-[opacity,color,background-color] hover:bg-negative-soft hover:text-negative sm:mr-3 sm:h-9 sm:w-9 sm:rounded-ui-sm"
          aria-label={`Delete ${label}`}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

function formatFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Whole words, not substrings: "wages" contains "age", so a substring test
 * declassified w2_wages as an identifier and printed it as a bare 166000.
 */
const MONEY_WORDS = new Set([
  "amount", "wage", "wages", "income", "tax", "taxes", "withheld", "withholding",
  "deduction", "deductions", "credit", "credits", "contribution", "contributions",
  "distribution", "distributions", "interest", "dividend", "dividends", "gain",
  "gains", "loss", "losses", "payment", "payments", "refund", "refunded",
  "overpaid", "owed", "balance", "basis", "proceeds", "expense", "expenses",
  "compensation", "benefit", "benefits", "premium", "total", "subtotal", "pay",
  // Seen in live extractions: va_agi, va_overpayment, va_subtractions,
  // net_earnings_from_self_employment.
  "agi", "overpayment", "subtraction", "subtractions", "earnings", "liability",
]);

/**
 * Identifiers that merely look big. Deciding by magnitude rendered a ZIP as
 * "$94,105" and the last four of an SSN as "$4,821", while a real $100 of
 * dividends printed bare next to $700 of interest in the same grid.
 */
const NEVER_MONEY_WORDS = new Set([
  "zip", "zipcode", "ssn", "ein", "tin", "year", "code", "codes", "phone",
  "account", "routing", "number", "id", "count", "percent", "percentage",
  "rate", "age", "quantity", "shares", "box",
]);

function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function formatFieldValue(value: unknown, key = ""): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    const words = keyWords(key);
    // An identifier wins over a money word: tax_year is a year, not dollars,
    // and it must not be thousands-separated either.
    if (words.some((w) => NEVER_MONEY_WORDS.has(w))) return String(value);
    if (words.some((w) => MONEY_WORDS.has(w))) {
      // Whole dollars show none, cents show both: 18234.5 was rendering as
      // "$18,234.5" rather than "$18,234.50".
      const cents = Number.isInteger(value) ? 0 : 2;
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents,
        maximumFractionDigits: cents,
      }).format(value);
    }
    return value.toLocaleString();
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) =>
        isNestedObject(v)
          ? Object.entries(v)
              .map(([k, inner]) => `${formatFieldKey(k)} ${formatFieldValue(inner, k)}`)
              .join(", ")
          : formatFieldValue(v, key),
      )
      .join(" / ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, inner]) => `${formatFieldKey(k)} ${formatFieldValue(inner, k)}`)
      .join(", ");
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
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
            {formatFieldKey(key)}
          </div>
          <div
            className={cn(
              "text-[14px] font-semibold text-content",
              typeof value === "number" && "ui-tnum",
            )}
          >
            {formatFieldValue(value, key)}
          </div>
        </div>
      ))}
    </div>
  );
}

function DocumentDetail({
  doc,
  showFileName,
  onClose,
}: {
  doc: TaxDocument;
  showFileName: boolean;
  onClose: () => void;
}) {
  const fields = doc.llmFields as Record<string, unknown>;
  const fieldEntries = Object.entries(fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  const metaKeys = new Set(["document_type", "form_type", "tax_year"]);
  const flatFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && !isNestedObject(v)
  );
  const nestedFields = fieldEntries.filter(
    ([k, v]) => !metaKeys.has(k) && isNestedObject(v)
  );

  return (
    // No max-height: the panel used to clip its own field grid mid-row inside
    // the page scroller, which read as a rendering fault rather than as more
    // content. The page scrolls, so this does not need to.
    <div className="p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        {/* The form type and tax year badges that used to sit here repeated the
            row directly above and the year control above that. */}
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Extracted fields</div>
          {/* Two lines by design. Inlining the filename left an orphaned "From"
              and a line opening with "." once the name wrapped at 390px. */}
          {showFileName && (
            <div className="mt-0.5 truncate text-[12.5px] text-content-muted" title={doc.fileName}>
              {doc.fileName}
            </div>
          )}
          {doc.createdAt && (
            <div className="mt-0.5 text-[12.5px] text-content-muted ui-tnum">
              Added {formatDocDate(doc.createdAt)}
            </div>
          )}
          <div className="mt-0.5 text-[12.5px] text-content-muted">
            The original file was not stored.
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="touch-target ui-focus grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm text-content-muted transition-colors hover:bg-canvas-sunken hover:text-content"
          aria-label="Close detail"
        >
          <X size={15} />
        </button>
      </div>

      {/* The extraction summary lives on the row itself now, 40px above this
          panel, so repeating it here was the same sentence twice on screen. */}

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
            <div className="mb-1.5 text-[13px] font-semibold text-content-muted">
              {formatFieldKey(key)}
            </div>
            <FieldGrid entries={entries} />
          </div>
        );
      })}
    </div>
  );
}
