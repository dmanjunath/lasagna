import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { FileText, Trash2, RefreshCw, Upload } from "lucide-react";
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import type { TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
import { api } from "../lib/api.js";
import { useChatStore } from "../lib/chat-store.js";
import { useInsights } from "../hooks/useInsights.js";
import { usePageContext } from "../lib/page-context.js";

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
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
  color: "var(--lf-muted)",
};

const SERIF: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
};

const FILING_YEAR = new Date().getFullYear() - 1;

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

  const { insights, isLoading: insightsLoading, refresh } = useInsights("tax");
  const { openChat } = useChatStore();
  const { setPageContext } = usePageContext();

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

  // ── page context for AI chat ─────────────────────────────────────────────
  useEffect(() => {
    if (profile) {
      setPageContext({
        pageId: "tax",
        pageTitle: "Tax Strategy",
        description: "Tax optimization suggestions and document management.",
        data: {
          filingStatus: profile.filingStatus,
          stateOfResidence: profile.stateOfResidence,
          documentCount: documents.length,
          taxOpportunities: insights.length,
        },
      });
    }
  }, [profile, documents.length, insights.length, setPageContext]);

  // ── handlers ─────────────────────────────────────────────────────────────
  const handleInputSuccess = useCallback(
    async (doc: TaxInputResult) => {
      setDocuments((prev) => [
        {
          id: doc.id,
          fileName: doc.fileName,
          llmSummary: doc.llmSummary,
          taxYear: doc.taxYear,
          createdAt: doc.createdAt,
        },
        ...prev,
      ]);
      setInsightStatus("generating");
      refresh()
        .then(() => setInsightStatus("done"))
        .catch(() => setInsightStatus("idle"));
    },
    [refresh]
  );

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, []);

  // ── derived values ────────────────────────────────────────────────────────
  const bracket = profile?.annualIncome
    ? estimateBracket(profile.annualIncome, profile.filingStatus)
    : null;

  const filingLabel = profile?.filingStatus
    ? FILING_LABELS[profile.filingStatus] ?? profile.filingStatus
    : null;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "clamp(16px, 4vw, 32px)",
        paddingBottom: "clamp(80px, 12vw, 48px)",
        background: "var(--lf-cream)",
        minHeight: 0,
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
        <div style={{ ...EYEBROW, marginBottom: 8 }}>
          Tax strategy · {FILING_YEAR} filing year
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1
            style={{
              ...SERIF,
              fontSize: "clamp(28px, 4vw, 40px)",
              color: "var(--lf-ink)",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Legally owed,{" "}
            <em style={{ color: "var(--lf-sauce)", fontStyle: "italic" }}>
              not overpaid.
            </em>
          </h1>
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
              Upload tax documents →
            </button>
          )}
        </div>
      </motion.div>

      {/* ── Mini stat cards ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.06 }}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {/* Filing status */}
        <MiniCard
          label="Filing status"
          value={filingLabel ?? "—"}
          sub={profile?.stateOfResidence ?? undefined}
        />
        {/* Marginal bracket */}
        <MiniCard
          label="Marginal bracket"
          value={bracket ?? "—"}
          sub={profile?.annualIncome ? formatMoney(profile.annualIncome) + " income" : undefined}
          valueColor={bracket ? "var(--lf-sauce)" : undefined}
        />
        {/* Est. refund — DATA-NEEDED: no refund estimate API available yet */}
        <MiniCard
          label="Est. refund"
          value="—"
          sub="Upload docs to estimate"
        />
        {/* Open opportunities */}
        <MiniCard
          label="Open opportunities"
          value={insightsLoading ? "…" : String(insights.length)}
          sub={insights.length === 1 ? "suggestion" : "suggestions"}
          valueColor={insights.length > 0 ? "var(--lf-basil)" : undefined}
        />
      </motion.div>

      {/* ── Opportunities list ───────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.12 }}
        style={{ ...CARD, marginBottom: 24, overflow: "hidden" }}
      >
        {/* Card header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--lf-rule)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <span style={{ ...EYEBROW }}>Opportunities</span>
            <span style={{ ...EYEBROW, color: "var(--lf-rule)", margin: "0 6px" }}>·</span>
            <span style={{ ...EYEBROW, color: "var(--lf-cheese)" }}>AI-generated, reviewable</span>
          </div>
          {insights.length > 0 && (
            <span
              style={{
                ...EYEBROW,
                background: "var(--lf-basil)",
                color: "var(--lf-paper)",
                borderRadius: 20,
                padding: "3px 10px",
              }}
            >
              {insights.length} found
            </span>
          )}
        </div>

        {/* List body */}
        {insightsLoading ? (
          <div
            style={{
              padding: "40px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--lf-muted)",
            }}
          >
            <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 13 }}>Loading tax insights…</span>
          </div>
        ) : insights.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "var(--lf-cream-deep)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
                fontSize: 18,
              }}
            >
              τ
            </div>
            <p style={{ color: "var(--lf-muted)", fontSize: 13, margin: "0 auto", maxWidth: 280 }}>
              Generate insights to see tax opportunities — upload a document or describe your situation below.
            </p>
          </div>
        ) : (
          <div>
            {insights.map((insight, i) => {
              const isHigh = insight.urgency === "high";
              const iconBg = isHigh
                ? "var(--lf-sauce)"
                : "var(--lf-cheese)";
              const prompt = insight.chatPrompt ?? `Tell me more about: ${insight.title}`;
              return (
                <motion.div
                  key={insight.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i }}
                  style={{
                    padding: "16px 20px",
                    borderBottom: i < insights.length - 1 ? "1px solid var(--lf-rule)" : "none",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                  }}
                >
                  {/* Icon chip */}
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 9,
                      background: iconBg,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      ...SERIF,
                      fontSize: 15,
                      color: "var(--lf-paper)",
                      marginTop: 2,
                    }}
                  >
                    τ
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--lf-ink)",
                        marginBottom: 3,
                      }}
                    >
                      {insight.title}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--lf-muted)",
                        lineHeight: 1.5,
                        marginBottom: insight.impact ? 6 : 0,
                      }}
                    >
                      {insight.description}
                    </div>
                    {insight.impact && (
                      <div
                        style={{
                          ...EYEBROW,
                          color: "var(--lf-basil)",
                          fontSize: 10,
                        }}
                      >
                        {insight.impact}
                      </div>
                    )}
                  </div>

                  {/* Ask how */}
                  <button
                    onClick={() => openChat(prompt)}
                    style={{
                      ...EYEBROW,
                      fontSize: 10,
                      background: "transparent",
                      border: "1px solid var(--lf-rule)",
                      borderRadius: 6,
                      padding: "5px 10px",
                      cursor: "pointer",
                      color: "var(--lf-muted)",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      marginTop: 2,
                      transition: "border-color 0.15s, color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--lf-ink)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-ink)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--lf-rule)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-muted)";
                    }}
                  >
                    Ask how →
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* ── Two-column bottom ───────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.18 }}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
        className="tax-bottom-grid"
      >
        {/* LEFT: Tax documents ─────────────────────────────────────────────── */}
        <div id="tax-documents-section" style={{ ...CARD, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--lf-rule)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={EYEBROW}>Tax documents</span>
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

          {/* Upload panel */}
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <div style={{ padding: 16 }}>
              <TaxInputPanel onSuccess={handleInputSuccess} />
            </div>
          )}

          {/* Uploaded docs list */}
          {documents.length > 0 && (
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ ...EYEBROW, marginBottom: 10, paddingTop: import.meta.env.VITE_DEMO_MODE === "true" ? 16 : 0 }}>
                Uploaded
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {documents.map((doc, i) => (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    style={{
                      background: "var(--lf-cream)",
                      border: "1px solid var(--lf-rule)",
                      borderRadius: 10,
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <FileText
                      size={16}
                      style={{ color: "var(--lf-muted)", flexShrink: 0, marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--lf-ink)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {doc.fileName}
                      </div>
                      {doc.taxYear && (
                        <div style={{ fontSize: 11, color: "var(--lf-muted)", marginTop: 2 }}>
                          Tax Year {doc.taxYear}
                        </div>
                      )}
                      {doc.llmSummary && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--lf-muted)",
                            marginTop: 4,
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
                    {import.meta.env.VITE_DEMO_MODE !== "true" && (
                      <button
                        onClick={() => handleDeleteDocument(doc.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          padding: 4,
                          borderRadius: 6,
                          color: "var(--lf-muted)",
                          flexShrink: 0,
                          transition: "color 0.15s",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-sauce)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-muted)";
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {documents.length === 0 && import.meta.env.VITE_DEMO_MODE === "true" && (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                color: "var(--lf-muted)",
                fontSize: 13,
              }}
            >
              No documents uploaded yet.
            </div>
          )}
        </div>

        {/* RIGHT: Contribution trackers ───────────────────────────────────── */}
        <div style={{ ...CARD, overflow: "hidden" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid var(--lf-rule)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={EYEBROW}>Contribution trackers</span>
            <span style={{ ...EYEBROW, color: "var(--lf-cheese)" }}>2024 limits</span>
          </div>

          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 20 }}>
            {/*
              DATA-NEEDED: no contribution tracking API available yet.
              Showing annual limit reference rows with placeholder progress.
            */}
            <ContributionRow
              label="401(k) pre-tax"
              sublabel="Employee contribution limit"
              limit="$23,500"
              // DATA-NEEDED: actual contributed amount not available
              pct={null}
              color="var(--lf-sauce)"
            />
            <ContributionRow
              label="Roth IRA"
              sublabel="Combined traditional + Roth limit"
              limit="$7,000"
              pct={null}
              color="var(--lf-cheese)"
            />
            <ContributionRow
              label="HSA"
              sublabel="Individual coverage limit"
              limit="$4,150"
              pct={null}
              color="var(--lf-basil)"
            />
          </div>

          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--lf-rule)",
            }}
          >
            <button
              onClick={() =>
                openChat(
                  "How much should I be contributing to my 401k, Roth IRA, and HSA this year?"
                )
              }
              style={{
                ...EYEBROW,
                fontSize: 10,
                background: "transparent",
                border: "1px solid var(--lf-rule)",
                borderRadius: 6,
                padding: "6px 12px",
                cursor: "pointer",
                color: "var(--lf-muted)",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--lf-ink)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-ink)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--lf-rule)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--lf-muted)";
              }}
            >
              How much should I contribute? →
            </button>
          </div>
        </div>
      </motion.div>

      {/* Responsive style override for narrow viewports */}
      <style>{`
        @media (max-width: 700px) {
          .tax-bottom-grid { grid-template-columns: 1fr !important; }
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
      <div style={{ ...EYEBROW, fontSize: 10, marginBottom: 8 }}>{label}</div>
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
        <div style={{ fontSize: 11, color: "var(--lf-muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function ContributionRow({
  label,
  sublabel,
  limit,
  pct,
  color,
}: {
  label: string;
  sublabel: string;
  limit: string;
  pct: number | null; // 0–100, or null = unknown
  color: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--lf-ink)" }}>{label}</div>
          <div style={{ fontSize: 11, color: "var(--lf-muted)", marginTop: 1 }}>{sublabel}</div>
        </div>
        <div style={{ ...EYEBROW, fontSize: 10 }}>{limit}</div>
      </div>
      {/* Progress bar */}
      <div
        style={{
          height: 5,
          borderRadius: 3,
          background: "var(--lf-cream-deep)",
          overflow: "hidden",
        }}
      >
        {pct !== null ? (
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, pct)}%`,
              background: color,
              borderRadius: 3,
              transition: "width 0.6s ease",
            }}
          />
        ) : (
          /* DATA-NEEDED: contribution amount not yet available — show empty bar */
          <div style={{ height: "100%", width: "0%", background: color, borderRadius: 3 }} />
        )}
      </div>
      {pct === null && (
        <div style={{ fontSize: 10, color: "var(--lf-muted)", marginTop: 4 }}>
          Connect accounts to track contributions
        </div>
      )}
    </div>
  );
}
