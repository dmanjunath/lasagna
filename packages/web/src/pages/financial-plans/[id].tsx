import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, FileText, PieChart, LineChart, Target, Lightbulb, Download } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button, Stat, Skeleton, EmptyState } from "../../components/uikit";
import { vizColor } from "../../components/uikit/viz.js";
import { formatMoney } from "../../lib/utils.js";
import { ChatPanel } from "../../components/chat/index.js";
import { BrandMark } from "../../components/common/BrandMark.js";
import { DISCLAIMER_COPY } from "../../components/common/legal-disclaimer.js";
import { useAuth } from "../../lib/auth.js";
import type {
  FinancialPlan,
  FinancialSnapshotBreakdownItem,
  PortfolioSection,
  RetirementReadinessSection,
  ReadinessVerdict,
  WhatIfSection,
  GoalsSection,
  SuggestionsSection,
  ChatThread,
  Message,
} from "../../lib/types.js";
import type { ToolResult } from "../../lib/types-v2.js";

// The message the "Complete your goals" CTA seeds into the plan chat. It nudges
// the agent to run its goals intake (ask for the missing goal inputs and call
// update_financial_plan_goals as the user answers).
const GOALS_INTAKE_PROMPT =
  "Help me set up my plan goals. Ask me for whatever is still missing (retirement age, the age my money should last through, my target annual retirement income, and any named goals like college, travel, or charity), then save them.";

// Account-type → friendly label for the breakdown legend/chart.
const TYPE_LABELS: Record<string, string> = {
  depository: "Cash",
  investment: "Investments",
  real_estate: "Property",
  credit: "Credit cards",
  loan: "Loans",
  other: "Other",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

// Viz slot per breakdown item: assets read cash/investments/property hues,
// debts read distinct debt-family hues so no two legend rows collide.
// Keeps the chart legible in light + dark.
function itemColor(item: FinancialSnapshotBreakdownItem): string {
  if (item.kind === "debt") {
    if (item.type === "credit") return vizColor(7);
    return vizColor(4);
  }
  if (item.type === "depository") return vizColor(1);
  if (item.type === "investment") return vizColor(2);
  if (item.type === "real_estate") return vizColor(3);
  return vizColor(5);
}

// Asset-class → viz slot, mirroring portfolio-composition.tsx so the plan's
// composition reads with the same hues as the /portfolio page.
const ASSET_CLASS_VIZ: Record<string, number> = {
  "US Stocks": 2,
  "International Stocks": 5,
  Bonds: 6,
  REITs: 3,
  Cash: 1,
  Other: 7,
};

function classColor(name: string, index: number): string {
  return vizColor(ASSET_CLASS_VIZ[name] ?? ((index % 7) + 1));
}

function fmtPct(p: number): string {
  if (p <= 0) return "0%";
  if (p < 0.1) return "<0.1%";
  return `${p.toFixed(1)}%`;
}

// Portfolio Composition — the top-level asset-type split as one shared-scale bar
// plus a grouped, de-duped breakdown (each class, then its de-duplicated category
// lines). Values come straight from aggregatePortfolio via the stored section.
function PortfolioCompositionSection({ portfolio }: { portfolio: PortfolioSection }) {
  const segments = portfolio.classes.filter((c) => c.value > 0);

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2.5">
        <span
          className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
          style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
          aria-hidden
        />
        <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
          Portfolio composition
        </span>
      </div>

      {segments.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<PieChart className="h-5 w-5" />}
          title="No investment holdings linked"
          description="Link an investment account to see how your portfolio breaks down by asset type."
        />
      ) : (
        <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
              By asset type
            </h3>
            <span className="ui-tnum text-[13px] font-bold text-content">
              {formatMoney(portfolio.totalValue)}
            </span>
          </div>

          {/* Shared-scale allocation bar across asset classes. */}
          <div
            className="mt-3 flex h-3.5 overflow-hidden rounded-full bg-canvas-sunken"
            role="img"
            aria-label="Portfolio allocation by asset type"
          >
            {segments.map((c, i) => (
              <span
                key={c.name}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${(c.value / portfolio.totalValue) * 100}%`,
                  background: classColor(c.name, i),
                }}
                aria-hidden
              />
            ))}
          </div>

          {/* Grouped, de-duped breakdown: each class then its category lines. */}
          <div className="mt-6 space-y-6">
            {segments.map((c, i) => (
              <div key={c.name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: classColor(c.name, i) }}
                      aria-hidden
                    />
                    <span className="truncate text-[14px] font-bold text-content">{c.name}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
                    <span className="text-[14px] font-bold text-content">{formatMoney(c.value)}</span>
                    <span className="ml-2 text-[12.5px] font-semibold text-content-muted">
                      {fmtPct(c.weight)}
                    </span>
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5 border-l border-line pl-4">
                  {c.categories.map((cat) => (
                    <li
                      key={cat.name}
                      className="flex items-center justify-between gap-3 text-[13.5px]"
                    >
                      <span className="truncate font-semibold text-content-secondary">{cat.name}</span>
                      <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
                        <span className="font-bold text-content">{formatMoney(cat.value)}</span>
                        <span className="ml-2 text-[12.5px] font-semibold text-content-muted">
                          {fmtPct(cat.weight)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Retirement Readiness ──────────────────────────────────────────────────────

// Short money label for the growth chart axis, matching the retirement page's
// terse "$1.2M / $340k" style.
function fmtShortMoney(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

const VERDICT_LABEL: Record<ReadinessVerdict, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  at_risk: "At risk",
};

// Verdict-band colors, mirroring retirement-v2.tsx's compositeColor/compositeBg
// (on track → brand, needs attention → caution, at risk → negative).
const VERDICT_STYLE: Record<ReadinessVerdict, { ink: string; bg: string }> = {
  on_track: { ink: "rgb(var(--ui-brand-ink))", bg: "var(--ui-brand-soft)" },
  needs_attention: { ink: "rgb(var(--ui-caution))", bg: "var(--ui-caution-soft)" },
  at_risk: { ink: "rgb(var(--ui-negative))", bg: "var(--ui-negative-soft)" },
};

// Median + 25th-75th band growth chart, segmented at retirement. A stored,
// non-interactive SVG mirroring the /retirement fan idiom with --ui-* tokens:
// accumulation tint before retirement, a dashed retirement marker, the p25-p75
// band, and the median path.
function GrowthChart({ section }: { section: RetirementReadinessSection }) {
  const pts = section.growth;
  const n = pts.length;
  if (n < 2) return null;

  const W = 760;
  const H = 240;
  const PL = 52;
  const PR = 16;
  const PT = 16;
  const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const maxV = Math.max(...pts.map((p) => p.p75), 1);
  const xf = (i: number) => PL + (i / Math.max(n - 1, 1)) * chartW;
  const yf = (v: number) => PT + chartH - Math.max(0, Math.min(1, v / maxV)) * chartH;
  const yTicks = [0.25, 0.5, 0.75, 1].map((pct) => ({ pct, val: maxV * pct, y: PT + chartH - pct * chartH }));

  const band = (upper: (p: (typeof pts)[number]) => number, lower: (p: (typeof pts)[number]) => number) => {
    let d = `M ${xf(0)},${yf(upper(pts[0]))}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(upper(pts[i]))}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${xf(i)},${yf(lower(pts[i]))}`;
    return d + " Z";
  };
  const line = (get: (p: (typeof pts)[number]) => number) => {
    let d = `M ${xf(0)},${yf(get(pts[0]))}`;
    for (let i = 1; i < n; i++) d += ` L ${xf(i)},${yf(get(pts[i]))}`;
    return d;
  };

  const retireIdx = Math.max(0, section.retirementAge - section.currentAge);
  const midIdx = Math.floor((n - 1) / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Projected portfolio balance by age">
      {/* Accumulation tint before retirement */}
      {retireIdx > 0 && retireIdx < n && (
        <rect x={xf(0)} y={PT} width={Math.max(0, xf(retireIdx) - xf(0))} height={chartH} fill="var(--ui-brand-softer)" />
      )}

      {/* Gridlines + y labels */}
      {yTicks.map(({ pct, val, y }) => (
        <g key={pct}>
          <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">
            {fmtShortMoney(val)}
          </text>
        </g>
      ))}

      {/* p25-p75 band + median path */}
      <path d={band((p) => p.p75, (p) => p.p25)} fill="var(--ui-viz-2)" fillOpacity={0.18} />
      <path d={line((p) => p.median)} fill="none" stroke="var(--ui-viz-2)" strokeWidth={2} strokeLinecap="round" />

      {/* Retirement marker */}
      {retireIdx > 0 && retireIdx < n && (
        <>
          <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={H - PB} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
          <text x={xf(retireIdx) + 5} y={H - PB - 6} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-brand-ink))">
            retire {section.retirementAge}
          </text>
        </>
      )}

      {/* X-axis ages */}
      <text x={xf(0)} y={H - 6} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">age {section.currentAge}</text>
      <text x={xf(midIdx)} y={H - 6} textAnchor="middle" fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">{section.currentAge + midIdx}</text>
      <text x={xf(n - 1)} y={H - 6} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">{section.currentAge + n - 1}</text>
    </svg>
  );
}

function RetirementReadinessSectionView({ section }: { section: RetirementReadinessSection }) {
  const eyebrow = (
    <div className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
        style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
        aria-hidden
      />
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
        Retirement readiness
      </span>
    </div>
  );

  if (!section.computed) {
    return (
      <section className="mt-10">
        {eyebrow}
        <EmptyState
          className="mt-4"
          icon={<LineChart className="h-5 w-5" />}
          title="Not enough to project yet"
          description="Link an investment or cash account so we can model whether you're on track to retire."
        />
      </section>
    );
  }

  const style = VERDICT_STYLE[section.verdict];
  const lastsThrough =
    section.medianLastsToAge === null
      ? `through age ${section.planThroughAge}`
      : `to age ${section.medianLastsToAge}`;

  return (
    <section className="mt-10">
      {eyebrow}

      {/* On-track verdict band: same threshold + color idiom as /retirement. */}
      <div
        className="mt-4 rounded-ui-xl border border-line shadow-ui-sm p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        style={{ background: style.bg }}
      >
        <div>
          <div className="text-[24px] sm:text-[28px] font-bold leading-none" style={{ color: style.ink }}>
            {VERDICT_LABEL[section.verdict]}
          </div>
          <p className="mt-2 text-[13.5px] font-semibold text-content-secondary">
            Odds your money lasts {lastsThrough}, retiring at {section.retirementAge}.
            {" "}Target is {section.targetSuccess}%.
          </p>
        </div>
        <div className="shrink-0 sm:text-right">
          <div className="ui-tnum text-[28px] font-bold leading-none" style={{ color: style.ink }}>
            {section.successRate}%
          </div>
          <div className="mt-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-content-muted">
            Success rate
          </div>
        </div>
      </div>

      {/* Projected growth: median + 25th-75th band, split at retirement. */}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
            Projected balance
          </h3>
          <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">
            {section.blendedExpectedReturn > 0 && (
              <>{(section.blendedExpectedReturn * 100).toFixed(1)}% expected return</>
            )}
          </span>
        </div>
        <div className="mt-4">
          <GrowthChart section={section} />
        </div>
        <div className="mt-2 flex items-center gap-5 text-[12px] font-semibold text-content-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-4 rounded-full" style={{ background: "var(--ui-viz-2)" }} aria-hidden />
            Median
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ui-viz-2)", opacity: 0.18 }} aria-hidden />
            25th-75th percentile
          </span>
        </div>
      </div>

      {/* Drawdown method comparison: the recommended optimal is marked. */}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
        <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
          Withdrawal method
        </h3>
        <p className="mt-1 text-[13px] text-content-muted">
          How you draw the portfolio down changes how long it lasts. We ran each method on your plan.
        </p>
        <ul className="mt-4 space-y-2">
          {section.methods.map((m) => (
            <li
              key={m.strategy}
              className="flex flex-col gap-1.5 rounded-ui-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              style={
                m.recommended
                  ? { borderColor: "rgb(var(--ui-brand))", background: "var(--ui-brand-softer)" }
                  : { borderColor: "rgb(var(--ui-line))" }
              }
            >
              <span className="flex flex-wrap items-center gap-2.5">
                <span className="text-[14px] font-bold text-content">{m.label}</span>
                {m.recommended && (
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--ui-brand-ink))] bg-brand-soft">
                    Recommended
                  </span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap sm:text-right ui-tnum">
                <span className="text-[14px] font-bold text-content">{m.successRate}%</span>
                {m.medianLastsToAge !== null && (
                  <span className="ml-2 text-[12.5px] font-semibold text-content-muted">
                    depletes at age {m.medianLastsToAge}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Drawdown order: the tax-treatment spending sequence. */}
      {section.drawdownOrder.length > 0 && (
        <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
            Drawdown order
          </h3>
          <p className="mt-1 text-[13px] text-content-muted">
            Which accounts to spend first in retirement, most tax-efficient first.
          </p>
          <ol className="mt-4 space-y-2">
            {section.drawdownOrder.map((u, i) => (
              <li key={u.bucket} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-3 min-w-0">
                  <span className="ui-tnum inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas-sunken text-[12px] font-bold text-content-secondary">
                    {i + 1}
                  </span>
                  <span className="truncate text-[14px] font-bold text-content">{u.label}</span>
                </span>
                <span className="ui-tnum shrink-0 text-[14px] font-bold text-content">
                  {formatMoney(u.balance, true)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ── What-if scenarios ─────────────────────────────────────────────────────────

// Render a scenario's delta vs the base success rate: a real minus sign for
// negatives, color from the --ui-positive/--ui-negative tokens, and an
// arrow glyph so the direction reads without relying on color alone. A delta of
// 0 stays neutral ("no change").
function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span className="ui-tnum text-[12.5px] font-bold text-content-muted">no change</span>
    );
  }
  const positive = delta > 0;
  return (
    <span
      className="ui-tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-bold"
      style={{
        color: positive ? "rgb(var(--ui-positive))" : "rgb(var(--ui-negative))",
        background: positive ? "var(--ui-positive-soft)" : "var(--ui-negative-soft)",
      }}
    >
      <span aria-hidden>{positive ? "↑" : "↓"}</span>
      {positive ? "+" : "−"}
      {Math.abs(delta)} pts
    </span>
  );
}

// The What-if section: re-runs of the SAME engine with overrides, each compared
// to the base plan's success rate so the "am I on track?" story stays explicit
// and consistent with the Retirement Readiness verdict above.
function WhatIfSectionView({ whatIfs }: { whatIfs: WhatIfSection | null }) {
  const eyebrow = (
    <div className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
        style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
        aria-hidden
      />
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
        What if?
      </span>
    </div>
  );

  if (!whatIfs || whatIfs.scenarios.length === 0) {
    return (
      <section className="mt-10">
        {eyebrow}
        <EmptyState
          className="mt-4"
          icon={<LineChart className="h-5 w-5" />}
          title="No scenarios yet"
          description="Once we can project your retirement, we'll model a few what-if scenarios here."
        />
      </section>
    );
  }

  return (
    <section className="mt-10">
      {eyebrow}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
            Try a different plan
          </h3>
          <span className="ui-tnum text-[12.5px] font-semibold text-content-muted">
            Base {whatIfs.baseSuccessRate}%
          </span>
        </div>
        <p className="mt-1 text-[13px] text-content-muted">
          Each scenario re-runs your plan with one change, compared to your current base success rate.
        </p>
        <ul className="mt-4 space-y-2">
          {whatIfs.scenarios.map((s) => (
            <li
              key={s.label}
              className="flex flex-col gap-1.5 rounded-ui-md border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-[14px] font-bold text-content">{s.label}</span>
              <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap sm:justify-end ui-tnum">
                <span className="text-[14px] font-bold text-content">{s.successRate}%</span>
                <DeltaBadge delta={s.deltaVsBase} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Goals ─────────────────────────────────────────────────────────────────────

// A goals section is "complete enough" once the three core numbers are set;
// named goals are optional extras, so they don't gate completeness.
function goalsComplete(goals: GoalsSection | null): boolean {
  return Boolean(
    goals &&
      goals.retirementAge != null &&
      goals.planEndAge != null &&
      goals.retirementIncome != null,
  );
}

function goalsEmpty(goals: GoalsSection | null): boolean {
  return (
    !goals ||
    (goals.retirementAge == null &&
      goals.planEndAge == null &&
      goals.retirementIncome == null &&
      (goals.namedGoals?.length ?? 0) === 0)
  );
}

// One stated goal value, or a muted "Not set yet" placeholder that reads as an
// invitation to fill it in via chat.
function GoalStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
      <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-content-muted">
        {label}
      </div>
      {value ? (
        <div className="mt-2 ui-tnum text-[22px] font-bold text-content">{value}</div>
      ) : (
        <div className="mt-2 text-[15px] font-semibold text-content-faint">Not set yet</div>
      )}
    </div>
  );
}

// The Goals section: the user's stated intent (retirement age, plan-end age,
// target annual income, named goals). Goals frame the plan, so this renders
// first. When the core goals aren't complete, a CTA seeds the plan chat with a
// goals intake so the agent gathers them and writes them back.
function GoalsSectionView({
  goals,
  onComplete,
}: {
  goals: GoalsSection | null;
  onComplete: () => void;
}) {
  const eyebrow = (
    <div className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
        style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
        aria-hidden
      />
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
        Goals
      </span>
    </div>
  );

  // Fully empty: a single invitation card, no half-filled stats to clutter it.
  if (goalsEmpty(goals)) {
    return (
      <section className="mt-8">
        {eyebrow}
        <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[rgb(var(--ui-brand-ink))]"
              aria-hidden
            >
              <Target className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-content">Set your plan goals</h3>
              <p className="mt-1 max-w-md text-[13.5px] font-semibold text-content-muted">
                Tell us when you want to retire, how long your money should last, the income you
                want, and any goals like college or travel.{" "}
                <span className="plan-print-hide">We'll ask in chat and fill them in.</span>
              </p>
            </div>
          </div>
          <Button className="shrink-0" onClick={onComplete}>
            Complete your goals
          </Button>
        </div>
      </section>
    );
  }

  const complete = goalsComplete(goals);
  const named = goals?.namedGoals ?? [];

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        {eyebrow}
        {!complete && (
          <Button variant="secondary" onClick={onComplete}>
            Complete your goals
          </Button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <GoalStat
          label="Retirement age"
          value={goals?.retirementAge != null ? String(goals.retirementAge) : null}
        />
        <GoalStat
          label="Plan through age"
          value={goals?.planEndAge != null ? String(goals.planEndAge) : null}
        />
        <GoalStat
          label="Annual income goal"
          value={goals?.retirementIncome != null ? formatMoney(goals.retirementIncome, true) : null}
        />
      </div>

      {named.length > 0 && (
        <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
            Named goals
          </h3>
          <ul className="mt-4 space-y-2">
            {named.map((g, i) => (
              <li
                key={`${g.label}-${i}`}
                className="flex flex-col gap-1 rounded-ui-md border border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="min-w-0">
                  <span className="text-[14px] font-bold text-content">{g.label}</span>
                  {g.note && (
                    <span className="mt-0.5 block text-[12.5px] font-semibold text-content-muted">
                      {g.note}
                    </span>
                  )}
                </span>
                {(g.targetAmount != null || g.targetYear != null) && (
                  <span className="shrink-0 whitespace-nowrap sm:text-right ui-tnum">
                    {g.targetAmount != null && (
                      <span className="text-[14px] font-bold text-content">
                        {formatMoney(g.targetAmount, true)}
                      </span>
                    )}
                    {g.targetYear != null && (
                      <span className="ml-2 text-[12.5px] font-semibold text-content-muted">
                        by {g.targetYear}
                      </span>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Suggestions ───────────────────────────────────────────────────────────────

// LLM-generated next steps grounded in the plan's real figures. Each item is a
// title + rationale, with an optional impact line and category chip. Absent on
// plans created before it shipped (or when the create-time model call failed),
// in which case a quiet empty state stands in so old plans never look broken.
function SuggestionsSectionView({ suggestions }: { suggestions: SuggestionsSection | null }) {
  const eyebrow = (
    <div className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
        style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
        aria-hidden
      />
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
        Suggestions
      </span>
    </div>
  );

  const items = suggestions?.items ?? [];

  return (
    <section className="mt-10">
      {eyebrow}
      {items.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Lightbulb className="h-5 w-5" />}
          title="No suggestions yet"
          description={
            <span className="plan-print-hide">
              Ask in chat for concrete next steps, or create a new plan once your accounts are
              linked.
            </span>
          }
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((s, i) => (
            <li
              key={`${s.title}-${i}`}
              className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[15px] font-bold text-content">{s.title}</h3>
                {s.category && (
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--ui-brand-ink))] bg-brand-soft">
                    {s.category}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[13.5px] font-semibold leading-relaxed text-content-secondary">
                {s.rationale}
              </p>
              {s.impact && (
                <p className="mt-2.5 text-[12.5px] font-semibold text-content-muted">
                  <span className="font-bold uppercase tracking-[0.06em] text-content-faint">
                    Impact
                  </span>{" "}
                  {s.impact}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Chat ABOUT this plan. The thread is scoped to the plan (financialPlanId), so
// the chat route grounds the agent in the plan's already-computed sections and
// answers reconcile with the Retirement Readiness verdict above. The thread is
// created lazily on the first send — a page view alone never creates one.
function PlanChat({
  planId,
  seed,
  onChatResponse,
  chatRef,
}: {
  planId: string;
  // Bump `seed.n` to inject `seed.prompt` into the chat (starting a thread if
  // needed). Used by the Goals "Complete your goals" CTA.
  seed: { n: number; prompt: string };
  onChatResponse: (toolResults: ToolResult[]) => void;
  chatRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Captured first prompt; passed to ChatPanel as initialMessage so the loop
  // auto-sends once the freshly-created thread mounts.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  const [creating, setCreating] = useState(false);
  // Bumped every time a prompt is seeded so the ChatPanel remounts and re-fires
  // its one-shot initialMessage even when a thread already exists (its
  // initialMessageSent ref only resets on remount).
  const [seedKey, setSeedKey] = useState(0);

  // Reset + load any existing plan-scoped thread when the plan changes.
  useEffect(() => {
    setThread(null);
    setMessages([]);
    setLoaded(false);
    setPendingPrompt(null);
    setComposer("");
    let cancelled = false;
    api
      .getFinancialPlanThreads(planId)
      .then(async ({ threads }) => {
        if (cancelled) return;
        if (threads.length > 0) {
          const t = threads[0];
          const { messages: msgs } = await api.getThread(t.id);
          if (cancelled) return;
          setThread(t);
          setMessages(msgs);
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const startThread = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      const { thread: newThread } = await api.createThread(undefined, undefined, undefined, planId);
      setThread(newThread);
      setPendingPrompt(text);
      setSeedKey((k) => k + 1);
      setComposer("");
    } catch (err) {
      console.error("Failed to start plan chat:", err);
    } finally {
      setCreating(false);
    }
  };

  // Seed a prompt into the chat from an outside CTA (the Goals "Complete your
  // goals" button). Creates the thread if there isn't one yet, otherwise sends
  // into the existing thread; scrolls the chat into view either way.
  const seededN = useRef(0);
  useEffect(() => {
    if (!loaded || seed.n === 0 || seed.n === seededN.current) return;
    seededN.current = seed.n;
    chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (thread) {
      setPendingPrompt(seed.prompt);
      setSeedKey((k) => k + 1);
    } else {
      startThread(seed.prompt);
    }
    // startThread/thread are stable enough for this one-shot signal; guarding on
    // seed.n keeps it from re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.n, loaded]);

  const eyebrow = (
    <div className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
        style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
        aria-hidden
      />
      <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
        Ask about this plan
      </span>
    </div>
  );

  if (!loaded) {
    return (
      <section ref={chatRef} className="mt-10 scroll-mt-6">
        {eyebrow}
        <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-10 w-full" />
        </div>
      </section>
    );
  }

  return (
    <section ref={chatRef} className="mt-10 scroll-mt-6">
      {eyebrow}
      <div className="mt-4 h-[520px] overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm">
        {thread ? (
          <ChatPanel
            key={`${thread.id}:${seedKey}`}
            threadId={thread.id}
            initialMessages={messages}
            initialMessage={pendingPrompt}
            onMessageSent={() => setPendingPrompt(null)}
            onChatResponse={(_r, toolResults) => onChatResponse(toolResults)}
            hideHeader
          />
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex-1 flex items-center justify-center p-6 text-center">
              <p className="max-w-sm text-[14px] font-semibold text-content-muted">
                Ask whether you're on track, how a different retirement age changes the odds,
                or anything else about this plan.
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                startThread(composer);
              }}
              className="flex gap-2 border-t border-line p-4"
            >
              <input
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="Am I on track to retire?"
                disabled={creating}
                className="flex-1 rounded-ui-md border border-line-strong bg-panel px-4 py-2 text-[14px] text-content placeholder:text-content-faint shadow-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-brand-ring)]"
              />
              <Button type="submit" disabled={creating || !composer.trim()}>
                Ask
              </Button>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}

// Print the plan document to PDF. Dark mode is a `.dark` class on <html>; the
// report must print on white with the light palette, so we drop `.dark` for the
// duration of the print and restore it after (the print CSS is the safety net).
// `window.print()` blocks until the dialog resolves in most browsers, but we
// also listen for `afterprint` so the theme is restored even when it doesn't.
function printPlanToPdf() {
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  if (wasDark) root.classList.remove("dark");
  const restore = () => {
    if (wasDark) root.classList.add("dark");
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
  // Fallback for browsers where print() returns before `afterprint` fires.
  setTimeout(restore, 0);
}

// Branded cover block, print-only. Reads like the first page of a consulting
// report: wordmark, plan title, whose plan it is, and the generated date.
function PrintCover({
  title,
  userName,
  generatedAt,
}: {
  title: string;
  userName: string | null;
  generatedAt: string;
}) {
  return (
    <div className="plan-print-only plan-print-cover">
      <div className="flex items-center gap-3">
        <BrandMark size={34} />
        <span className="font-editorial text-[20px] font-semibold leading-none tracking-[-0.01em] text-content">
          LasagnaFi
        </span>
      </div>
      <div className="mt-10 border-t border-line pt-8">
        <div className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-content-muted">
          Financial Plan
        </div>
        <h1 className="mt-3 font-editorial text-[40px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
          {title}
        </h1>
        <p className="mt-4 text-[14px] font-semibold text-content-muted ui-tnum">
          {userName ? `Prepared for ${userName} · ` : ""}
          Generated {new Date(generatedAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}

export function FinancialPlanDetailPage() {
  const [, params] = useRoute("/financial-plans/:id");
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const id = params?.id;

  const [plan, setPlan] = useState<FinancialPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"notfound" | "generic" | null>(null);
  // The Goals "Complete your goals" CTA bumps this counter to seed the plan
  // chat's goals intake; PlanChat reacts to the count change.
  const [goalsSeed, setGoalsSeed] = useState(0);
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .getFinancialPlan(id)
      .then((p) => setPlan(p))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "";
        setError(msg === "Plan not found" ? "notfound" : "generic");
      })
      .finally(() => setLoading(false));
  }, [id]);

  // After a chat turn, if the agent saved goals, refetch the plan so the Goals
  // section reflects what was just written (no full page reload).
  const refreshIfGoalsSaved = (toolResults: ToolResult[]) => {
    if (!id) return;
    if (!toolResults.some((t) => t.toolName === "update_financial_plan_goals")) return;
    api
      .getFinancialPlan(id)
      .then((p) => setPlan(p))
      .catch(() => {
        // Non-fatal: the next page load will show the saved goals.
      });
  };

  const snapshot = plan?.document?.sections.snapshot ?? null;
  const portfolio = plan?.document?.sections.portfolio ?? null;
  const retirement = plan?.document?.sections.retirement ?? null;
  const whatIfs = plan?.document?.sections.whatIfs ?? null;
  const goals = plan?.document?.sections.goals ?? null;
  const suggestions = plan?.document?.sections.suggestions ?? null;

  return (
    <div className="plan-print-root mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <button
        onClick={() => navigate("/financial-plans")}
        className="plan-print-hide inline-flex items-center gap-1.5 text-[13px] font-semibold text-content-muted hover:text-content transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Financial Plans
      </button>

      {/* ════════ Loading ════════ */}
      {loading && (
        <div className="mt-6">
          <Skeleton className="h-9 w-1/2" />
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-4 h-8 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ════════ Error ════════ */}
      {!loading && error && (
        <div className="mt-8">
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={error === "notfound" ? "Plan not found" : "Couldn't load this plan"}
            description={
              error === "notfound"
                ? "This plan may have been deleted, or it belongs to another account."
                : "Something went wrong loading this plan. Please try again."
            }
            action={
              <Button variant="secondary" onClick={() => navigate("/financial-plans")}>
                Back to plans
              </Button>
            }
          />
        </div>
      )}

      {/* ════════ Document ════════ */}
      {!loading && !error && plan && snapshot && (
        <>
          {/* Branded cover — print only. */}
          <PrintCover
            title={plan.title}
            userName={user?.name ?? null}
            generatedAt={snapshot.generatedAt}
          />

          {/* On-screen header + the Download PDF action (hidden in print). */}
          <header className="mt-6 flex items-start justify-between gap-4 print:hidden">
            <div>
              <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
                {plan.title}
              </h1>
              <p className="mt-2 text-[14px] font-semibold text-content-muted ui-tnum">
                Generated {new Date(snapshot.generatedAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              leadingIcon={<Download className="h-4 w-4" />}
              onClick={printPlanToPdf}
            >
              Download PDF
            </Button>
          </header>

          {/* Goals section — the user's stated intent frames the plan, so it
              leads. Its CTA seeds the plan chat's goals intake below. */}
          <GoalsSectionView goals={goals} onComplete={() => setGoalsSeed((n) => n + 1)} />

          {/* Financial Snapshot section */}
          <section className="mt-8">
            <div className="flex items-center gap-2.5">
              <span
                className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
                style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
                aria-hidden
              />
              <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
                Financial snapshot
              </span>
            </div>

            {/* Net worth headline + supporting KPIs */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:col-span-1">
                <Stat label="Net worth" value={formatMoney(snapshot.netWorth)} />
              </div>
              <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
                <Stat
                  label="Total assets"
                  value={formatMoney(snapshot.totalAssets)}
                  caption="Across your linked accounts"
                />
              </div>
              <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
                <Stat
                  label="Total debt"
                  value={formatMoney(snapshot.totalDebt)}
                  caption="Credit and loans"
                />
              </div>
            </div>

            {/* Assets vs debt visual + monthly spending */}
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 lg:col-span-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-content-muted">
                  Assets vs debt
                </h3>
                {snapshot.breakdown.length > 0 ? (
                  (() => {
                    // Two bars on ONE shared dollar scale so their lengths are
                    // directly comparable: assets - debt reads as net worth.
                    const assets = snapshot.breakdown.filter((b) => b.kind === "asset");
                    const debts = snapshot.breakdown.filter((b) => b.kind === "debt");
                    // Legend order: assets first, then debts (not raw API order).
                    const ordered = [...assets, ...debts];
                    const scale = Math.max(snapshot.totalAssets, snapshot.totalDebt) || 1;

                    const bar = (
                      label: string,
                      total: number,
                      segments: FinancialSnapshotBreakdownItem[],
                    ) => (
                      <div>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-content-muted">
                            {label}
                          </span>
                          <span className="ui-tnum text-[13px] font-bold text-content">
                            {formatMoney(total)}
                          </span>
                        </div>
                        <div
                          className="mt-1.5 flex h-3.5 overflow-hidden rounded-full bg-canvas-sunken"
                          style={{ width: `${(total / scale) * 100}%`, minWidth: total > 0 ? "3%" : 0 }}
                        >
                          {segments.map((b, i) => (
                            <span
                              key={i}
                              className="h-full first:rounded-l-full last:rounded-r-full"
                              style={{
                                width: `${total > 0 ? (b.value / total) * 100 : 0}%`,
                                background: itemColor(b),
                              }}
                              aria-hidden
                            />
                          ))}
                        </div>
                      </div>
                    );

                    return (
                      <div className="mt-4">
                        <div className="space-y-3">
                          {bar("Assets", snapshot.totalAssets, assets)}
                          {bar("Debt", snapshot.totalDebt, debts)}
                        </div>
                        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                          {ordered.map((b, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 text-[13.5px]">
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ background: itemColor(b) }}
                                  aria-hidden
                                />
                                <span className="truncate font-semibold text-content-secondary">
                                  {typeLabel(b.type)}
                                </span>
                              </span>
                              <span className="ui-tnum font-bold text-content shrink-0">
                                {formatMoney(b.value)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()
                ) : (
                  <p className="mt-4 text-[13.5px] text-content-muted">
                    No account balances to break down yet. Link accounts to see assets vs debt.
                  </p>
                )}
              </div>

              <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
                <Stat
                  label="Monthly spending"
                  value={formatMoney(snapshot.monthlySpend)}
                  caption="Previous calendar month"
                />
                {snapshot.annualIncome != null && (
                  <p className="mt-4 text-[13px] text-content-muted ui-tnum">
                    Annual income {formatMoney(snapshot.annualIncome)}
                    {snapshot.age != null && <> · Age {snapshot.age}</>}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Portfolio Composition section — absent on plans created before it
              shipped, in which case we recompute nothing and show the empty
              state so old plans never crash. */}
          <PortfolioCompositionSection
            portfolio={
              portfolio ?? {
                section: "portfolio",
                totalValue: 0,
                classes: [],
                generatedAt: snapshot.generatedAt,
              }
            }
          />

          {/* Retirement Readiness section: absent on plans created before it
              shipped, in which case we show the un-computed empty state so old
              plans never crash. */}
          <RetirementReadinessSectionView
            section={
              retirement ?? {
                section: "retirement",
                computed: false,
                currentAge: snapshot.age ?? 40,
                retirementAge: 65,
                planThroughAge: 90,
                successRate: 0,
                targetSuccess: 85,
                verdict: "at_risk",
                medianLastsToAge: null,
                blendedExpectedReturn: 0,
                growth: [],
                methods: [],
                recommendedStrategy: "constant_dollar",
                drawdownOrder: [],
                generatedAt: snapshot.generatedAt,
              }
            }
          />

          {/* What-if scenarios — deterministic re-runs of the SAME engine with
              overrides, each shown as a delta vs the base success rate. Absent
              on plans created before it shipped (and when the base wasn't
              computable), so we render it only when the section exists rather
              than showing an empty state on old plans. */}
          {whatIfs && <WhatIfSectionView whatIfs={whatIfs} />}

          {/* Suggestions section — LLM-generated next steps grounded in the
              plan's real figures. Absent on plans created before it shipped or
              when the create-time model call failed; shows a quiet empty
              state in that case. */}
          <SuggestionsSectionView suggestions={suggestions} />

          {/* Chat about this plan — grounded in the sections above. Also the
              surface where the Goals CTA seeds the goals intake. Interactive,
              so it's dropped from the printed report. */}
          {id && (
            <div className="plan-print-hide">
              <PlanChat
                planId={id}
                seed={{ n: goalsSeed, prompt: GOALS_INTAKE_PROMPT }}
                onChatResponse={refreshIfGoalsSaved}
                chatRef={chatRef}
              />
            </div>
          )}

          {/* Legal disclaimer — print only, closes the report. Reuses the
              projections copy so it stays single-sourced with the app. */}
          <p className="plan-print-only mt-12 border-t border-line pt-6 text-center text-[11px] leading-[1.5] text-content-muted">
            {DISCLAIMER_COPY.projections}
          </p>
        </>
      )}
    </div>
  );
}
