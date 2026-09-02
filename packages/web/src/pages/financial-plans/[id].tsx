import { Fragment, useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, FileText, Download, X, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { watchReport } from "../../lib/report-watcher.js";
import { Button, Stat, Skeleton, EmptyState } from "../../components/uikit";
import { SegmentedControl } from "../../components/uikit/SegmentedControl.js";
import { vizColor } from "../../components/uikit/viz.js";
import { formatMoney, splitParagraphs } from "../../lib/utils.js";
import { ChatPanel } from "../../components/chat/index.js";
import { BrandMark } from "../../components/common/BrandMark.js";
import { PlanFreshnessBanner } from "../../components/common/plan-freshness-banner.js";
import { planFreshness } from "../../lib/plan-freshness.js";
import { DISCLAIMER_COPY } from "../../components/common/legal-disclaimer.js";
import { useAuth } from "../../lib/auth.js";
import type {
  FinancialPlan,
  PlanAssumptions,
  FinancialSnapshotBreakdownItem,
  PortfolioSection,
  RetirementReadinessSection,
  ReadinessVerdict,
  WhatIfSection,
  GoalsSection,
  SuggestionsSection,
  NarrativeSection,
  NarrativeThemeKey,
  StrategySection,
  ScheduleSection,
  ScheduleRow,
  ChatThread,
  Message,
  FreeformReport,
  FinancialPlanDocument,
} from "../../lib/types.js";
import type { ToolResult } from "../../lib/types-v2.js";

// On-screen layout for the report. "document" is the narrow single-column
// (reads like the PDF); "wide" fills the app width with prose beside exhibits.
// Persisted so a reader's choice sticks across visits; print ALWAYS renders the
// document regardless (the @media print grids collapse to one column).
type ReportLayout = "document" | "wide";
const LAYOUT_KEY = "plan-report-layout";
function readInitialLayout(): ReportLayout {
  if (typeof window === "undefined") return "wide";
  return window.localStorage.getItem(LAYOUT_KEY) === "document" ? "document" : "wide";
}

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

// The byline under the masthead + on the print cover, single-sourced so screen
// and PDF read identically. Comma separator per UX.md (no middots or dashes).
function planByline(userName: string | null, generatedAt: string): string {
  const date = new Date(generatedAt).toLocaleDateString();
  return userName ? `Prepared for ${userName}, generated ${date}` : `Generated ${date}`;
}

// The cover's generated date, set apart as its own line (the cover composes
// "Prepared for {name}" and the date on separate rows, unlike the compact
// masthead byline). A long-form month/day/year reads more like a report.
function planCoverDate(generatedAt: string): string {
  return new Date(generatedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
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

// ── Editorial primitives (single-use, inline per CLAUDE.md) ───────────────────

// A numbered section head: a thin top rule across the full frame, then the
// numeral in Sans + the section name as a tracked muted label.
// Replaces the old accent-dot eyebrows. Prose/body is constrained by callers to
// ~65ch; wide figures fill a wider measure.
function ReportSection({
  n,
  label,
  children,
}: {
  n: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="plan-section mt-12 sm:mt-14 border-t border-line pt-10">
      <div className="plan-section-head flex items-baseline gap-3">
        {n && (
          <span className="text-[12px] font-semibold leading-none text-content-faint ui-tnum">
            {n}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-muted">
          {label}
        </span>
      </div>
      {children}
    </section>
  );
}

// An inline captioned exhibit: a top hairline, an "Exhibit N  Title" label, the
// exhibit itself, then a one-line caption. No card — figures sit on the paper.
// The `.plan-figure` class is the print break-inside-avoid target.
function Figure({
  n,
  title,
  caption,
  children,
  // Wide layout drops the 720px cap so the exhibit fills its grid column; the
  // print override collapses the grid, so the PDF is unaffected either way.
  wide,
}: {
  n: number;
  title: string;
  caption?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className={`plan-figure mt-6 ${wide ? "max-w-[720px] lg:max-w-none" : "max-w-[720px]"} border-t border-line pt-5`}>
      <figcaption className="flex items-baseline gap-2.5">
        <span className="text-[11px] font-semibold leading-none text-content-faint ui-tnum">
          Exhibit {n}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-content-muted">
          {title}
        </span>
      </figcaption>
      <div className="mt-4">{children}</div>
      {caption && <p className="mt-2 text-[12px] leading-[1.5] text-content-muted">{caption}</p>}
    </figure>
  );
}

// ── Narrative (editorial prose) ───────────────────────────────────────────────

// Look up a theme's prose body by key. Returns null when the narrative is absent
// (old plans, or a failed create-time gen) or the theme wasn't produced, so every
// section degrades gracefully to its exhibit-only rendering.
function themeBody(narrative: NarrativeSection | null, key: NarrativeThemeKey): string | null {
  return narrative?.themes.find((t) => t.key === key)?.body ?? null;
}

// A theme's prose rendered as the LEDE atop its section's exhibits: a comfortable
// ~65ch measure, readable body color, paragraphs split on any run of newlines.
// Nothing renders when the body is absent, so a missing theme leaves the section
// exactly as it was before the narrative shipped.
function ThemeLede({ body, className }: { body: string | null; className?: string }) {
  if (!body) return null;
  const paras = splitParagraphs(body);
  return (
    <div className={`plan-prose mt-4 max-w-[660px] space-y-3 ${className ?? ""}`}>
      {paras.map((p, i) => (
        <p key={i} className="text-[14.5px] leading-[1.56] text-content-secondary">
          {p}
        </p>
      ))}
    </div>
  );
}

// ── Retirement Readiness ──────────────────────────────────────────────────────

// Short money label for the growth chart axis, matching the retirement page's
// terse "$1.2M / $340k" style. Drops a trailing ".0" so round decade ticks read
// as "$1M" not "$1.0M", and handles billions for long-horizon terminal values.
function fmtShortMoney(v: number): string {
  const trim = (s: string) => s.replace(/\.0$/, "");
  if (v >= 1e9) return `$${trim((v / 1e9).toFixed(1))}B`;
  if (v >= 1e6) return `$${trim((v / 1e6).toFixed(1))}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

const VERDICT_LABEL: Record<ReadinessVerdict, string> = {
  on_track: "On track",
  needs_attention: "Needs attention",
  at_risk: "At risk",
};

// Verdict colors, mirroring retirement-v2.tsx's compositeColor/compositeBg
// (on track → brand, needs attention → caution, at risk → negative).
const VERDICT_STYLE: Record<ReadinessVerdict, { ink: string; bg: string }> = {
  on_track: { ink: "rgb(var(--ui-brand-ink))", bg: "var(--ui-brand-soft)" },
  needs_attention: { ink: "rgb(var(--ui-caution))", bg: "var(--ui-caution-soft)" },
  at_risk: { ink: "rgb(var(--ui-negative))", bg: "var(--ui-negative-soft)" },
};

// Median + 25th-75th band growth chart, segmented at retirement. A stored,
// non-interactive SVG mirroring the /retirement fan idiom with --ui-* tokens.
//
// The balance compounds ~1000x over a 50+ year horizon, so a LINEAR y-axis pins
// the curve to the baseline for decades before it spikes — uninformative. The
// y-axis is therefore LOG-scaled: steady compounding reads as a near-straight
// climb across the whole width, and the p25-p75 band stays a legible ribbon
// rather than a hairline. Decade ($1M, $10M, $100M) gridlines are labelled, a
// few age ticks anchor x, a dashed marker calls out retirement, and the
// at-retirement + terminal medians are annotated.
function GrowthChart({ section }: { section: RetirementReadinessSection }) {
  const pts = section.growth;
  const n = pts.length;
  if (n < 2) return null;

  const W = 760;
  const H = 240;
  const PL = 56;
  const PR = 64; // room for the terminal-value annotation at the right edge
  const PT = 20;
  const PB = 28;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  // Log-scale domain. Floor at the smallest lower-band value (never < $1k so
  // log() stays finite), ceiling at the largest upper-band value, each padded
  // out to the enclosing power of ten so the curve doesn't kiss the frame.
  const rawMin = Math.max(1e3, Math.min(...pts.map((p) => p.p25)));
  const rawMax = Math.max(...pts.map((p) => p.p75), rawMin * 10);
  const minV = Math.pow(10, Math.floor(Math.log10(rawMin)));
  const maxV = Math.pow(10, Math.ceil(Math.log10(rawMax)));
  const lgMin = Math.log10(minV);
  const lgMax = Math.log10(maxV);

  const xf = (i: number) => PL + (i / Math.max(n - 1, 1)) * chartW;
  const yf = (v: number) => {
    const t = (Math.log10(Math.max(v, minV)) - lgMin) / (lgMax - lgMin || 1);
    return PT + chartH - Math.max(0, Math.min(1, t)) * chartH;
  };

  // A gridline per decade across the log domain.
  const yTicks: number[] = [];
  for (let e = lgMin; e <= lgMax + 0.001; e++) yTicks.push(Math.pow(10, e));

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

  const retireIdx = Math.max(0, Math.min(n - 1, section.retirementAge - section.currentAge));
  const showRetire = retireIdx > 0 && retireIdx < n - 1;
  const atRetire = pts[retireIdx]?.median ?? 0;
  const terminal = pts[n - 1]?.median ?? 0;

  // X-axis: current age, retirement, and the final age. The retirement tick is
  // only added when it's far enough from the start age that the labels won't
  // collide (the dashed marker + its top annotation already call it out).
  const frac = retireIdx / Math.max(n - 1, 1);
  const ages: Array<{ i: number; label: string; anchor: "start" | "middle" | "end" }> = [
    { i: 0, label: `age ${section.currentAge}`, anchor: "start" },
  ];
  if (showRetire && frac > 0.12 && frac < 0.88) {
    ages.push({ i: retireIdx, label: String(section.retirementAge), anchor: "middle" });
  }
  ages.push({ i: n - 1, label: String(section.currentAge + n - 1), anchor: "end" });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Projected portfolio balance by age, log scale">
      {/* Accumulation tint before retirement */}
      {showRetire && (
        <rect x={xf(0)} y={PT} width={Math.max(0, xf(retireIdx) - xf(0))} height={chartH} fill="var(--ui-brand-softer)" />
      )}

      {/* Decade gridlines + y labels */}
      {yTicks.map((val) => {
        const y = yf(val);
        return (
          <g key={val}>
            <line x1={PL} x2={PL + chartW} y1={y} y2={y} stroke="var(--ui-line)" strokeDasharray="2 4" />
            <text x={PL - 8} y={y + 4} textAnchor="end" fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">
              {fmtShortMoney(val)}
            </text>
          </g>
        );
      })}

      {/* p25-p75 band + median path */}
      <path d={band((p) => p.p75, (p) => p.p25)} fill="var(--ui-viz-2)" fillOpacity={0.18} />
      <path d={line((p) => p.median)} fill="none" stroke="var(--ui-viz-2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* Retirement marker + at-retirement median. The "retire N · $X" label is
          only drawn when the marker is far enough from the left edge (frac >
          0.14) that it won't crowd the opening "age N" x-tick; near the start
          the dashed marker + circle alone call retirement out. */}
      {showRetire && (
        <>
          <line x1={xf(retireIdx)} x2={xf(retireIdx)} y1={PT} y2={PT + chartH} stroke="rgb(var(--ui-brand))" strokeDasharray="4 4" strokeWidth={1} />
          <circle cx={xf(retireIdx)} cy={yf(atRetire)} r={3} fill="rgb(var(--ui-brand))" />
          {frac > 0.14 && (
            <text x={xf(retireIdx) + 6} y={PT + 12} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontWeight={600} fontSize={11} fill="rgb(var(--ui-brand-ink))">
              retire {section.retirementAge}, {fmtShortMoney(atRetire)}
            </text>
          )}
        </>
      )}

      {/* Terminal median value, pinned to the right of the last point */}
      <circle cx={xf(n - 1)} cy={yf(terminal)} r={3} fill="var(--ui-viz-2)" />
      <text x={xf(n - 1) + 7} y={yf(terminal) + 4} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontWeight={700} fontSize={11.5} fill="var(--ui-viz-2)">
        {fmtShortMoney(terminal)}
      </text>

      {/* X-axis ages */}
      {ages.map(({ i, label, anchor }) => (
        <text key={label} x={xf(i)} y={H - 6} textAnchor={anchor} fontFamily="inherit" style={{ fontVariantNumeric: "tabular-nums" }} fontSize={11} fill="rgb(var(--ui-content-muted))">
          {label}
        </text>
      ))}
    </svg>
  );
}

function RetirementReadinessSectionView({
  section,
  lede,
  sectionNo,
  projectedBalanceExhibit,
  withdrawalMethodExhibit,
  drawdownOrderExhibit,
  wide,
}: {
  section: RetirementReadinessSection;
  lede?: React.ReactNode;
  sectionNo: string;
  projectedBalanceExhibit: number;
  withdrawalMethodExhibit: number;
  drawdownOrderExhibit: number;
  wide?: boolean;
}) {
  if (!section.computed) {
    return (
      <ReportSection n={sectionNo} label="Retirement readiness">
        <p className="mt-4 max-w-[660px] text-[14.5px] leading-[1.56] text-content-muted">
          There is not enough linked yet to project retirement. Link an investment or cash account
          so we can model whether you are on track to retire.
        </p>
      </ReportSection>
    );
  }

  const style = VERDICT_STYLE[section.verdict];
  const lastsThrough =
    section.medianLastsToAge === null
      ? `through age ${section.planThroughAge}`
      : `to age ${section.medianLastsToAge}`;

  return (
    <ReportSection n={sectionNo} label="Retirement readiness">
      {/* Row 1: lede + verdict pull-quote beside the projected-balance chart. */}
      <div className={wide ? "plan-wide-grid lg:grid lg:grid-cols-12 lg:gap-x-14 lg:items-start" : ""}>
        <div className="lg:col-span-5">
          {lede}

          {/* Verdict as a restrained left-rule pull-quote, not a loud card. */}
          <div
            className="mt-6 max-w-[660px] rounded-ui-md py-4 pl-5 pr-4"
            style={{ background: style.bg, borderLeft: `3px solid ${style.ink}` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[19px] font-bold leading-none" style={{ color: style.ink }}>
                {VERDICT_LABEL[section.verdict]}
              </span>
              <span className="ui-tnum text-[19px] font-bold leading-none" style={{ color: style.ink }}>
                {section.successRate}%
              </span>
            </div>
            <p className="mt-2 text-[13.5px] leading-[1.55] text-content-secondary">
              Odds your money lasts {lastsThrough}, retiring at {section.retirementAge}. Target is{" "}
              {section.targetSuccess}%.
            </p>
          </div>
        </div>

        {/* Projected growth: median + 25th-75th band, split at retirement. */}
        <div className="lg:col-span-7">
          <Figure
            n={projectedBalanceExhibit}
            title="Projected balance"
            wide={wide}
            caption={
              <>
                Median with the 25th to 75th percentile band, split at retirement. Log
                scale, so steady compounding reads as a straight climb.
                {section.blendedExpectedReturn > 0 && (
                  <> {(section.blendedExpectedReturn * 100).toFixed(1)}% blended expected return.</>
                )}
              </>
            }
          >
            <div className="plan-chart-well rounded-ui-md bg-canvas-sunken/50 p-5">
              <GrowthChart section={section} />
              <div className="mt-2 flex items-center gap-5 text-[12px] font-semibold text-content-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[3px] w-4 rounded-full" style={{ background: "var(--ui-viz-2)" }} aria-hidden />
                  Median
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ui-viz-2)", opacity: 0.18 }} aria-hidden />
                  25th to 75th percentile
                </span>
              </div>
            </div>
          </Figure>
        </div>
      </div>

      {/* Row 2: withdrawal method + drawdown order side-by-side in Wide. */}
      <div className={wide ? "plan-wide-grid lg:grid lg:grid-cols-2 lg:gap-x-12 lg:items-start" : ""}>
      {/* Drawdown method comparison: the recommended optimal is marked. */}
      <Figure
        n={withdrawalMethodExhibit}
        title="Withdrawal method"
        wide={wide}
        caption="How you draw the portfolio down changes how long it lasts. Each method run on your plan."
      >
        <ul className="divide-y divide-line">
          {section.methods.map((m) => (
            <li
              key={m.strategy}
              className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="flex flex-wrap items-center gap-2.5">
                <span className="text-[14px] font-semibold text-content">{m.label}</span>
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
      </Figure>

      {/* Drawdown order: the tax-treatment spending sequence. */}
      {section.drawdownOrder.length > 0 && (
        <Figure
          n={drawdownOrderExhibit}
          title="Drawdown order"
          wide={wide}
          caption="Which accounts to spend first in retirement, most tax-efficient first."
        >
          <ol className="divide-y divide-line">
            {section.drawdownOrder.map((u, i) => (
              <li key={u.bucket} className="flex items-center justify-between gap-3 py-3">
                <span className="inline-flex items-center gap-3 min-w-0">
                  <span className="ui-tnum inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas-sunken text-[12px] font-bold text-content-secondary">
                    {i + 1}
                  </span>
                  <span className="truncate text-[14px] font-semibold text-content">{u.label}</span>
                </span>
                <span className="ui-tnum shrink-0 text-[14px] font-bold text-content">
                  {formatMoney(u.balance, true)}
                </span>
              </li>
            ))}
          </ol>
        </Figure>
      )}
      </div>
    </ReportSection>
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
function WhatIfSectionView({
  whatIfs,
  lede,
  scenariosExhibit,
  sectionNo,
  wide,
}: {
  whatIfs: WhatIfSection;
  lede?: React.ReactNode;
  scenariosExhibit: number;
  sectionNo: string;
  wide?: boolean;
}) {
  return (
    <ReportSection n={sectionNo} label="What if?">
      <div className={wide ? "plan-wide-grid lg:grid lg:grid-cols-12 lg:gap-x-14 lg:items-start" : ""}>
      <div className="lg:col-span-5">{lede}</div>
      <div className="lg:col-span-7">
      <Figure
        n={scenariosExhibit}
        title="Try a different plan"
        wide={wide}
        caption={`Each scenario re-runs your plan with one change, compared to your base success rate of ${whatIfs.baseSuccessRate}%.`}
      >
        <ul className="divide-y divide-line">
          {whatIfs.scenarios.map((s) => (
            <li
              key={s.label}
              className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-[14px] font-semibold text-content">{s.label}</span>
              <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap sm:justify-end ui-tnum">
                <span className="text-[14px] font-bold text-content">{s.successRate}%</span>
                <DeltaBadge delta={s.deltaVsBase} />
              </span>
            </li>
          ))}
        </ul>
      </Figure>
      </div>
      </div>
    </ReportSection>
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

// One stated goal value as a borderless label-over-value row, or a muted "Not
// set yet" placeholder that reads as an invitation to fill it in via chat.
function GoalStat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="px-1 py-1">
      <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-content-muted">
        {label}
      </div>
      {value ? (
        <div className="mt-2 ui-tnum text-[21px] font-bold text-content">{value}</div>
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
  sectionNo,
  namedGoalsExhibit,
  wide,
}: {
  goals: GoalsSection | null;
  onComplete: () => void;
  sectionNo: string;
  namedGoalsExhibit: number;
  wide?: boolean;
}) {
  // Fully empty: a left-rule prose invitation, no half-filled rows to clutter it.
  if (goalsEmpty(goals)) {
    return (
      <ReportSection n={sectionNo} label="Goals">
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-[540px] border-l-[3px] border-line-strong pl-4 text-[14.5px] leading-[1.56] text-content-secondary">
            Tell us when you want to retire, how long your money should last, the income you want,
            and any goals like college or travel.{" "}
            <span className="plan-print-hide text-content-muted">We will ask in chat and fill them in.</span>
          </p>
          <Button className="shrink-0 plan-print-hide" onClick={onComplete}>
            Complete your goals
          </Button>
        </div>
      </ReportSection>
    );
  }

  const complete = goalsComplete(goals);
  const named = goals?.namedGoals ?? [];

  return (
    <ReportSection n={sectionNo} label="Goals">
      {!complete && (
        <div className="mt-4 plan-print-hide">
          <Button variant="secondary" onClick={onComplete}>
            Complete your goals
          </Button>
        </div>
      )}

      {/* Borderless KPI rows: hairline dividers between, stacked on mobile. */}
      <div className={`mt-6 ${wide ? "" : "max-w-[720px]"} grid grid-cols-1 divide-y divide-line min-[640px]:grid-cols-3 min-[640px]:divide-x min-[640px]:divide-y-0`}>
        <div className="py-4 min-[640px]:py-0 min-[640px]:pr-6">
          <GoalStat
            label="Retirement age"
            value={goals?.retirementAge != null ? String(goals.retirementAge) : null}
          />
        </div>
        <div className="py-4 min-[640px]:py-0 min-[640px]:px-6">
          <GoalStat
            label="Plan through age"
            value={goals?.planEndAge != null ? String(goals.planEndAge) : null}
          />
        </div>
        <div className="py-4 min-[640px]:py-0 min-[640px]:pl-6">
          <GoalStat
            label="Annual income goal"
            value={goals?.retirementIncome != null ? formatMoney(goals.retirementIncome, true) : null}
          />
        </div>
      </div>

      {named.length > 0 && (
        <Figure n={namedGoalsExhibit} title="Named goals" wide={wide}>
          <ul className="divide-y divide-line">
            {named.map((g, i) => (
              <li
                key={`${g.label}-${i}`}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <span className="min-w-0">
                  <span className="text-[14px] font-semibold text-content">{g.label}</span>
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
        </Figure>
      )}
    </ReportSection>
  );
}

// ── Suggestions ───────────────────────────────────────────────────────────────

// LLM-generated next steps grounded in the plan's real figures. Each item is a
// numbered editorial entry: title + rationale, an optional impact line and a
// quiet inline category chip. Absent on plans created before it shipped (or when
// the create-time model call failed), in which case a one-line prose empty state
// stands in so old plans never look broken.
function SuggestionsSectionView({
  suggestions,
  lede,
  sectionNo,
  wide,
}: {
  suggestions: SuggestionsSection | null;
  lede?: React.ReactNode;
  sectionNo: string;
  wide?: boolean;
}) {
  const items = suggestions?.items ?? [];

  return (
    <ReportSection n={sectionNo} label="Suggestions">
      {lede}
      {items.length === 0 ? (
        <p className="mt-4 max-w-[660px] text-[14.5px] leading-[1.56] text-content-muted">
          No suggestions yet.{" "}
          <span className="plan-print-hide">
            Ask in chat for concrete next steps, or create a new plan once your accounts are linked.
          </span>
        </p>
      ) : (
        <ol className={`mt-6 ${wide ? "plan-wide-2col lg:grid lg:grid-cols-2 lg:gap-x-12 lg:gap-y-0" : ""}`}>
          {items.map((s, i) => (
            <li key={`${s.title}-${i}`} className="border-t border-line pt-5 mt-5 first:mt-0">
              <div className="flex items-start justify-between gap-4">
                <h3 className="flex min-w-0 items-baseline gap-2.5 text-[15px] font-bold text-content">
                  <span className="shrink-0 text-[12px] font-semibold leading-none text-content-faint ui-tnum">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 break-words">{s.title}</span>
                </h3>
                {s.category && (
                  <span className="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--ui-brand-ink))] bg-brand-soft">
                    {s.category}
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-[660px] text-[14.5px] leading-[1.56] text-content-secondary">
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
        </ol>
      )}
    </ReportSection>
  );
}

// ── Strategy (LLM strategist output) ─────────────────────────────────────────

// Renders when `sections.strategy` exists (new-engine plans). Absent on legacy
// plans which carry `narrative`/`suggestions` instead.
function StrategySectionView({
  strategy,
  watchNo,
  strategyNo,
  exploreNo,
}: {
  strategy: StrategySection | null;
  watchNo: string;
  strategyNo: string;
  exploreNo: string;
}) {
  if (!strategy) return null;

  return (
    <>
      {/* Situation headline — a prominent lead paragraph opening the report.
          Absent when the grounding gate dropped an ungrounded draft headline. */}
      {strategy.situationHeadline && (
        <div className="plan-prose mt-10 max-w-[660px]">
          <p className="text-[19px] leading-snug text-content">{strategy.situationHeadline}</p>
        </div>
      )}

      {/* Watch-outs — risks/flags to address. */}
      {strategy.watchouts.length > 0 && (
        <ReportSection n={watchNo} label="What to watch">
          <ol className="mt-6 space-y-0">
            {strategy.watchouts.map((w, i) => (
              <li key={`watchout-${i}`} className="border-t border-line pt-5 mt-5 first:mt-0">
                <h3 className="text-[15px] font-bold text-content">{w.title}</h3>
                <p className="mt-2 max-w-[660px] text-[14.5px] leading-[1.56] text-content-secondary">
                  {w.detail}
                </p>
              </li>
            ))}
          </ol>
        </ReportSection>
      )}

      {/* Core strategies — actionable moves grounded in the plan's figures. */}
      {strategy.strategies.length > 0 && (
        <ReportSection n={strategyNo} label="Strategy">
          <ol className="mt-6 space-y-0">
            {strategy.strategies.map((s, i) => (
              <li key={`strategy-${i}`} className="border-t border-line pt-5 mt-5 first:mt-0">
                <h3 className="text-[15px] font-bold text-content">{s.title}</h3>
                <p className="mt-2 max-w-[660px] text-[14.5px] leading-[1.56] text-content-secondary">
                  {s.detail}
                </p>
                {s.quantifiedImpact && (
                  <p className="mt-2.5 text-[12.5px] font-semibold text-content-muted">
                    <span className="font-bold uppercase tracking-[0.06em] text-content-faint">
                      Impact
                    </span>{" "}
                    {s.quantifiedImpact}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </ReportSection>
      )}

      {/* Explore — directional ideas, lower-commitment than core strategies. */}
      {strategy.explore.length > 0 && (
        <ReportSection n={exploreNo} label="Ideas to explore">
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {strategy.explore.map((e, i) => (
              <div
                key={`explore-${i}`}
                className="rounded-ui-md bg-canvas-sunken px-4 py-3"
              >
                <p className="text-[14px] font-bold text-content">{e.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-[1.5] text-content-secondary">
                  {e.detail}
                </p>
              </div>
            ))}
          </div>
        </ReportSection>
      )}
    </>
  );
}

// The rebuild control. One definition, because the banner and the bare button
// are the same control in two places and must not drift apart.
const REFRESH_ACTION = {
  label: "Refresh from accounts",
  title:
    "Rebuild this plan from your current accounts and data. Use after linking a new account.",
  icon: <RefreshCw className="h-3.5 w-3.5" />,
};

// ── Freeform advisor report (experiment) ─────────────────────────────────────
// The model authored the entire report as one self-contained HTML document.
// Rendered verbatim in a sandboxed iframe (no scripts run); the input box is a
// FEEDBACK channel — the model revises its own report from each note.
function FreeformReportView({
  planId,
  planTitle,
  report,
  onRevised,
}: {
  planId: string;
  planTitle: string;
  report: FreeformReport;
  onRevised: (doc: FinancialPlanDocument) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(1200);

  const status = report.status ?? "ready";
  const busy = status === "generating" || status === "revising";
  // Freshness for the plan on screen. One item, so it never comes back "none".
  const freshness = planFreshness([{ generatedAt: report.generatedAt, reportStatus: status }]);

  // Generation runs server-side: poll the plan while busy, and register with
  // the app-level watcher so leaving this page still ends in a toast.
  useEffect(() => {
    if (!busy) return;
    watchReport(planId, planTitle);
    const interval = window.setInterval(async () => {
      try {
        const plan = await api.getFinancialPlan(planId);
        const ff = plan.document?.freeform;
        if (ff && (ff.status ?? "ready") !== status) {
          onRevised(plan.document!);
        }
      } catch {
        // transient — next tick retries
      }
    }, 8000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, status, planId]);

  const measure = () => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.body) setFrameHeight(Math.max(600, doc.body.scrollHeight + 40));
  };

  // The iframe's height is measured from its content, so it must RE-measure
  // when its width changes (e.g. the chat sidebar opening narrows the report,
  // the text rewraps taller, and a stale height leaves an inner scrollbar).
  // Width-guarded so our own height updates don't re-trigger the observer.
  const lastWidthRef = useRef(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(w - lastWidthRef.current) < 1) return;
      lastWidthRef.current = w;
      // Two passes: right after the width change, and once the reflow settles.
      requestAnimationFrame(measure);
      window.setTimeout(measure, 250);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, report.html]);

  const send = async () => {
    const note = feedback.trim();
    if (!note || sending || busy) return;
    setSending(true);
    setSendError(false);
    try {
      const { document } = await api.sendPlanFeedback(planId, note);
      setFeedback("");
      onRevised(document); // status flips to "revising"; polling takes over
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const retry = async () => {
    try {
      const { document } = await api.regenerateFreeformReport(planId);
      onRevised(document);
    } catch {
      setSendError(true);
    }
  };

  // ── Generating (no report yet) ────────────────────────────────────────────
  if (status === "generating") {
    return (
      <div className="mt-6">
        <div className="rounded-ui-md border border-line bg-panel px-5 py-5 shadow-ui-sm">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4.5 w-4.5 animate-spin text-content-muted" aria-hidden />
            <div>
              <p className="text-[14.5px] font-bold text-content">
                Writing your plan
              </p>
              <p className="mt-0.5 text-[13px] text-content-secondary">
                Usually about ten minutes. Feel free to browse the rest of the app. A
                notification will let you know the moment it&apos;s ready.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      </div>
    );
  }

  // ── Failed creation (nothing to show) ─────────────────────────────────────
  if (status === "failed") {
    return (
      <div className="mt-8">
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="The plan couldn't be generated"
          description={report.error ?? "Something went wrong while writing this plan."}
          action={<Button onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Revising: the previous report stays readable underneath. */}
      {status === "revising" && (
        <div className="mb-4 flex items-center gap-3 rounded-ui-md border border-line bg-canvas-sunken px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-content-muted" aria-hidden />
          <p className="text-[13px] text-content-secondary">
            Updating the plan.
          </p>
        </div>
      )}

      {/* Plan actions — separate from feedback: Refresh rebuilds from CURRENT
          data (new accounts etc.), feedback only revises the words. Once the
          plan goes stale the banner carries the SAME control, so the bare
          button steps aside rather than stacking a second one. */}
      {freshness.kind === "stale" ? (
        <PlanFreshnessBanner
          className="mb-3"
          freshness={freshness}
          refresh={{
            ...REFRESH_ACTION,
            onClick: retry,
            disabled: sending || busy,
          }}
        />
      ) : (
        <div className="mb-3 flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={retry}
            disabled={sending || busy}
            title={REFRESH_ACTION.title}
            leadingIcon={REFRESH_ACTION.icon}
          >
            {REFRESH_ACTION.label}
          </Button>
        </div>
      )}

      {/* Feedback composer — the only input on a freeform report. */}
      <div className="rounded-ui-md border border-line bg-panel px-4 py-3 shadow-ui-sm">
        <div className="flex items-center gap-3">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            disabled={sending || busy}
            placeholder="Feedback on this plan"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-content placeholder:text-content-faint focus:outline-none disabled:opacity-60"
          />
          <Button onClick={send} disabled={sending || busy || !feedback.trim()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
        {sendError && !sending && (
          <p className="mt-2 text-[12.5px] text-[rgb(var(--ui-negative))]">
            That didn&apos;t go through. Try again.
          </p>
        )}
        {report.error && !sendError && status === "ready" && (
          <p className="mt-2 text-[12.5px] text-[rgb(var(--ui-caution))]">{report.error}</p>
        )}
        {(report.history?.length ?? 0) > 0 && (
          <p className="mt-2 text-[12px] text-content-faint">
            {report.history!.length} revision{report.history!.length === 1 ? "" : "s"} applied,
            last updated {new Date(report.generatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {/* The report itself, exactly as the model wrote it. Sandboxed: no scripts. */}
      <iframe
        ref={frameRef}
        title="Retirement plan"
        sandbox="allow-same-origin"
        srcDoc={report.html}
        onLoad={measure}
        style={{ height: frameHeight }}
        className="mt-5 w-full rounded-ui-md border border-line bg-white shadow-ui-sm"
      />
    </div>
  );
}

// ── Cashflow & drawdown schedule (deterministic engine) ───────────────────────

// Human labels for the tax model's filing-status enum (never show the raw enum).
const FILING_STATUS_LABELS: Record<string, string> = {
  single: "single",
  married_joint: "married filing jointly",
  married_separate: "married filing separately",
  head_of_household: "head of household",
};

// Sum of guaranteed income sources for a row.
function rowGuaranteedIncome(row: ScheduleRow): number {
  return row.guaranteedIncome.socialSecurity + row.guaranteedIncome.rental + row.guaranteedIncome.other;
}

// Renders when `sections.schedule?.computed` is true. Placed after Retirement
// Readiness so the year-by-year detail follows the odds summary.
function ScheduleTableView({
  schedule,
  sectionNo,
  arithmeticReturn,
}: {
  schedule: ScheduleSection | null;
  sectionNo: string;
  /** The readiness section's (arithmetic) expected return, so the caption can
   *  reconcile the two growth figures instead of contradicting Exhibit copy. */
  arithmeticReturn: number | null;
}) {
  // Ages whose per-account drawdown detail is expanded.
  const [expandedAges, setExpandedAges] = useState<Set<number>>(new Set());
  if (!schedule?.computed || schedule.rows.length === 0) return null;

  const toggleAge = (age: number) =>
    setExpandedAges((prev) => {
      const next = new Set(prev);
      if (next.has(age)) next.delete(age);
      else next.add(age);
      return next;
    });

  const { rows, flags, assumptions } = schedule;

  // Sparse row selection: current-age row, retirement-age row, then every
  // retirement year. This keeps the table from being ~50+ rows in Phase 1.
  const retirementRows = rows.filter((r) => r.phase === "retirement");
  const firstRetirementAge = retirementRows[0]?.age ?? null;
  const currentRow = rows[0] ?? null;
  const retirementRow = firstRetirementAge != null
    ? rows.find((r) => r.age === firstRetirementAge) ?? null
    : null;

  const displayRows: ScheduleRow[] = [];
  if (currentRow) displayRows.push(currentRow);
  if (retirementRow && retirementRow !== currentRow) displayRows.push(retirementRow);
  for (const r of retirementRows) {
    if (r !== retirementRow) displayRows.push(r);
  }

  // Key-figure chips from flags, each with a plain-language explainer so no
  // chip requires prior knowledge (bridge / tax-free band / RMD).
  const chips: { label: string; value: string; hint: string; caution?: boolean }[] = [];
  if (flags.bridge) {
    chips.push({
      label: "Bridge to 59½",
      value: flags.bridge.covered
        ? "Covered"
        : `${formatMoney(flags.bridge.shortfallTotal, true)} short`,
      hint: "taxable + cash fund you until retirement accounts unlock",
      caution: !flags.bridge.covered,
    });
  }
  if (flags.taxFreeCapacityAtRetirement > 0) {
    chips.push({
      label: "Tax-free withdrawals",
      value: `${formatMoney(flags.taxFreeCapacityAtRetirement, true)}/yr`,
      hint: "at $0 federal tax (standard deduction + 0% gains band)",
    });
  }
  if (flags.coastFi.deferredPlusRothAt59 > 0) {
    chips.push({
      label: "Retirement accounts at 59½",
      value: formatMoney(flags.coastFi.deferredPlusRothAt59, true),
      hint: "what tax-deferred + Roth grow to if left untouched",
    });
  }
  if (flags.rmd) {
    chips.push({
      label: "First required withdrawal",
      value: formatMoney(flags.rmd.firstAmount, true),
      hint: `est. IRS minimum from tax-deferred at ${flags.rmd.firstAge} (RMD), not forced in this schedule`,
    });
  }
  if (flags.depleted && flags.firstShortfallAge != null) {
    chips.push({
      label: "Portfolio depleted",
      value: `at age ${flags.firstShortfallAge}`,
      hint: "spending outruns the accounts on this path",
      caution: true,
    });
  }

  // Bucket columns that carry any value across the horizon; an always-empty
  // bucket (e.g. no HSA) renders nothing instead of a column of $0s.
  const visibleBuckets = (["taxable", "deferred", "roth", "hsa"] as const).filter((b) =>
    rows.some(
      (r) => r.buckets[b].end > 0 || r.buckets[b].withdrawal > 0 || r.buckets[b].contribution > 0,
    ),
  );
  const BUCKET_HEADS: Record<(typeof visibleBuckets)[number], string> = {
    taxable: "Taxable",
    deferred: "Deferred",
    roth: "Roth",
    hsa: "HSA",
  };
  // Age + bucket columns + Guaranteed/Withdrawal/Tax/Tax-free/Total.
  const totalCols = 1 + visibleBuckets.length + 5;

  return (
    <ReportSection n={sectionNo} label="Cashflow & drawdown schedule">
      {/* Key-figure chips strip */}
      {chips.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {chips.map((chip, i) => (
            <div
              key={i}
              className="rounded-ui-md bg-canvas-sunken px-3 py-2.5"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                {chip.label}
              </div>
              <div
                className={`mt-0.5 ui-tnum text-[15px] font-bold ${chip.caution ? "text-[rgb(var(--ui-negative))]" : "text-content"}`}
              >
                {chip.value}
              </div>
              <div className="mt-0.5 text-[11.5px] leading-[1.4] text-content-faint">
                {chip.hint}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Year-by-year schedule table */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-[13px] sm:min-w-[640px]">
          <thead>
            <tr className="border-b border-line">
              <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                Age
              </th>
              {visibleBuckets.map((b) => (
                <th
                  key={b}
                  className="hidden pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted sm:table-cell"
                >
                  {BUCKET_HEADS[b]}
                </th>
              ))}
              <th className="hidden pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted sm:table-cell">
                Guaranteed
              </th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                <span className="sm:hidden">Draw</span>
                <span className="hidden sm:inline">Withdrawal</span>
              </th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                <span className="sm:hidden">Tax</span>
                <span className="hidden sm:inline">Tax on draws</span>
              </th>
              <th className="hidden pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted sm:table-cell">
                Tax-free
              </th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {displayRows.map((row) => {
              const isShortfall = row.shortfall > 0;
              const accountFlows = row.accounts ?? [];
              const hasDetail = accountFlows.length > 0;
              const isExpanded = expandedAges.has(row.age);
              // What the detail shows: draws in retirement, contributions while
              // accumulating; ending balances either way.
              const detailFlows = accountFlows.filter(
                (f) => f.withdrawal > 0 || f.contribution > 0 || f.end > 0,
              );
              return (
                <Fragment key={row.age}>
                <tr
                  className={`group ${hasDetail ? "cursor-pointer hover:bg-canvas-sunken" : ""}`}
                  onClick={hasDetail ? () => toggleAge(row.age) : undefined}
                >
                  <td className="whitespace-nowrap py-2 pr-3 text-[13px] font-semibold text-content ui-tnum">
                    {hasDetail ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAge(row.age);
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`Age ${row.age}: show which accounts fund this year`}
                        className="inline-flex items-center gap-1 rounded-ui-sm focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_var(--ui-brand-ring)]"
                      >
                        <svg
                          viewBox="0 0 12 12"
                          className={`h-2.5 w-2.5 shrink-0 text-content-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          aria-hidden
                        >
                          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {row.age}
                      </button>
                    ) : (
                      <span>{row.age}</span>
                    )}
                    {row.age === firstRetirementAge && (
                      <span className="ml-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--ui-brand-ink))] bg-brand-soft rounded-full px-1.5 py-0.5">
                        Retire
                      </span>
                    )}
                  </td>
                  {visibleBuckets.map((b) => (
                    <td
                      key={b}
                      className="hidden py-2 pr-3 text-right ui-tnum text-[13px] text-content-secondary sm:table-cell"
                    >
                      {formatMoney(row.buckets[b].end, true)}
                    </td>
                  ))}
                  <td className="hidden py-2 pr-3 text-right ui-tnum text-[13px] text-content-secondary sm:table-cell">
                    {formatMoney(rowGuaranteedIncome(row), true)}
                  </td>
                  <td className="py-2 pr-3 text-right ui-tnum text-[13px] text-content-secondary">
                    {formatMoney(row.portfolioWithdrawal, true)}
                  </td>
                  <td className="py-2 pr-3 text-right ui-tnum text-[13px] text-content-secondary">
                    {formatMoney(row.estimatedTax, true)}
                  </td>
                  <td className="hidden py-2 pr-3 text-right ui-tnum text-[13px] text-content-secondary sm:table-cell">
                    {formatMoney(row.taxFreeWithdrawal, true)}
                  </td>
                  <td
                    className={`py-2 text-right ui-tnum text-[13px] font-bold ${isShortfall ? "text-[rgb(var(--ui-negative))]" : "text-content"}`}
                  >
                    {formatMoney(row.totalPortfolio, true)}
                  </td>
                </tr>
                {isExpanded && detailFlows.length > 0 && (
                  <tr className="bg-canvas-sunken/50">
                    <td colSpan={totalCols} className="px-3 py-3">
                      {/* w-0/min-w-full keeps this colSpan cell from widening the
                          table's columns when it expands. */}
                      <div className="w-0 min-w-full">
                        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                          {detailFlows.map((f) => (
                            <div
                              key={f.id}
                              className="flex min-w-0 flex-col gap-0.5 text-[12.5px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                            >
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="min-w-0 truncate text-content-secondary" title={f.name}>
                                  {f.name}
                                </span>
                                <span className="shrink-0 text-[10.5px] uppercase tracking-[0.05em] text-content-faint">
                                  {f.earmarked
                                    ? "earmarked, not drawn"
                                    : f.bucket === "deferred"
                                      ? "Tax-deferred"
                                      : f.bucket}
                                </span>
                              </span>
                              <span className="shrink-0 ui-tnum whitespace-nowrap">
                                {f.withdrawal > 0 && (
                                  <span className="font-semibold text-content">
                                    −{formatMoney(f.withdrawal, true)}
                                  </span>
                                )}
                                {f.contribution > 0 && (
                                  <span className="font-semibold text-[rgb(var(--ui-brand-ink))]">
                                    +{formatMoney(f.contribution, true)}
                                  </span>
                                )}
                                <span className="ml-2 text-content-muted">
                                  {formatMoney(f.end, true)} left
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Assumptions caption */}
      <p className="mt-3 text-[12px] leading-[1.5] text-content-muted">
        {rows.some((r) => (r.accounts ?? []).length > 0) && (
          <>Click a year to see which accounts fund it. </>
        )}
        Projected at {(assumptions.blendedReturn * 100).toFixed(1)}% annual growth
        {arithmeticReturn != null && (
          <> (the portfolio&apos;s {(arithmeticReturn * 100).toFixed(1)}% expected return
          adjusted for volatility)</>
        )}
        , filing {FILING_STATUS_LABELS[assumptions.filingStatus] ?? assumptions.filingStatus}.
        Each year&apos;s withdrawals plus guaranteed income cover that year&apos;s spending and
        the estimated tax on draws. Federal tax estimates ({assumptions.taxYear}), not tax
        advice.
      </p>
    </ReportSection>
  );
}

// ── Portfolio ─────────────────────────────────────────────────────────────────

// Portfolio Composition — the top-level asset-type split as one shared-scale bar
// plus a grouped, de-duped breakdown (each class, then its de-duplicated category
// lines). Values come straight from aggregatePortfolio via the stored section.
function PortfolioCompositionSection({
  portfolio,
  sectionNo,
  byAssetTypeExhibit,
  wide,
}: {
  portfolio: PortfolioSection;
  sectionNo: string;
  byAssetTypeExhibit: number;
  wide?: boolean;
}) {
  const segments = portfolio.classes.filter((c) => c.value > 0);

  return (
    <ReportSection n={sectionNo} label="Portfolio composition">
      {segments.length === 0 ? (
        <p className="mt-4 max-w-[660px] text-[14.5px] leading-[1.56] text-content-muted">
          No investment holdings are linked. Link an investment account to see how your portfolio
          breaks down by asset type.
        </p>
      ) : (
        <Figure
          n={byAssetTypeExhibit}
          title="By asset type"
          wide={wide}
          caption={`Total portfolio value ${formatMoney(portfolio.totalValue, true)}.`}
        >
          {/* Shared-scale allocation bar across asset classes. */}
          <div
            className="flex h-3.5 overflow-hidden rounded-full bg-canvas-sunken"
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

          {/* Grouped, de-duped breakdown: each class then its category lines.
              In Wide it becomes a 2-col grid, so the vertical rhythm moves from
              space-y to the grid's gap-y (which the print override collapses). */}
          <div className={`mt-6 space-y-6 ${wide ? "plan-wide-2col lg:grid lg:grid-cols-2 lg:gap-x-12 lg:gap-y-6 lg:space-y-0" : ""}`}>
            {segments.map((c, i) => (
              <div key={c.name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: classColor(c.name, i) }}
                      aria-hidden
                    />
                    <span className="truncate text-[14px] font-semibold text-content">{c.name}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
                    <span className="text-[14px] font-bold text-content">{formatMoney(c.value, true)}</span>
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
                        <span className="font-bold text-content">{formatMoney(cat.value, true)}</span>
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
        </Figure>
      )}
    </ReportSection>
  );
}

// ── Chat about this plan ──────────────────────────────────────────────────────

// Chat ABOUT this plan. The thread is scoped to the plan (financialPlanId), so
// the chat route grounds the agent in the plan's already-computed sections and
// answers reconcile with the Retirement Readiness verdict below. The thread is
// created lazily on the first send — a page view alone never creates one. It
// leads the report as a composer-first entry point, expanding the transcript
// inline once a thread exists.
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
  // Collapsed by default so the report/exec-summary leads. The transcript slab
  // only mounts on expand; the compact composer is always the entry point.
  const [expanded, setExpanded] = useState(false);

  // Reset + load any existing plan-scoped thread when the plan changes.
  useEffect(() => {
    setThread(null);
    setMessages([]);
    setLoaded(false);
    setPendingPrompt(null);
    setComposer("");
    setExpanded(false);
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
      setExpanded(true);
    } catch (err) {
      console.error("Failed to start plan chat:", err);
    } finally {
      setCreating(false);
    }
  };

  // Send the compact composer's text into an already-existing thread: seed it as
  // the ChatPanel's one-shot initialMessage (remounting via seedKey so it fires)
  // and expand the transcript so the reply is visible.
  const sendIntoThread = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    setPendingPrompt(text);
    setSeedKey((k) => k + 1);
    setComposer("");
    setExpanded(true);
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
      setExpanded(true);
    } else {
      startThread(seed.prompt);
    }
    // startThread/thread are stable enough for this one-shot signal; guarding on
    // seed.n keeps it from re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed.n, loaded]);

  const header = (
    <div>
      <span className="text-[15px] font-semibold text-content">
        Ask about this plan
      </span>
      <p className="mt-1 text-[13.5px] text-content-muted">
        Ask whether you are on track, how a different retirement age changes the odds, or anything
        else about this plan.
      </p>
    </div>
  );

  if (!loaded) {
    return (
      <div ref={chatRef} className="mt-8 scroll-mt-6">
        {header}
        <div className="mt-3 rounded-ui-md border border-line-strong bg-panel p-4 shadow-ui-sm">
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

  // The transcript slab is mounted only when expanded, so a page view leads with
  // the report, not a 560px chat. ChatPanel carries its own composer, so the
  // compact composer below is hidden while expanded.
  if (thread && expanded) {
    return (
      <div ref={chatRef} className="mt-8 scroll-mt-6">
        <div className="flex items-center justify-between gap-3">
          {header}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-content-muted hover:text-content transition-colors"
          >
            Hide conversation
            <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
          </button>
        </div>
        <div className="mt-3 h-[min(70vh,560px)] flex flex-col rounded-ui-md border border-line-strong bg-panel shadow-ui-sm">
          <ChatPanel
            key={`${thread.id}:${seedKey}`}
            threadId={thread.id}
            initialMessages={messages}
            initialMessage={pendingPrompt}
            onMessageSent={() => setPendingPrompt(null)}
            onChatResponse={(_r, toolResults) => onChatResponse(toolResults)}
            hideHeader
          />
        </div>
      </div>
    );
  }

  // Collapsed: a quiet composer entry point. When a thread already has history, a
  // "View conversation" affordance expands the scrollable transcript inline.
  return (
    <div ref={chatRef} className="mt-8 scroll-mt-6">
      {header}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (thread) sendIntoThread(composer);
          else startThread(composer);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          placeholder="Am I on track to retire?"
          disabled={creating}
          className="flex-1 rounded-ui-md border border-line-strong bg-panel px-4 py-2.5 text-[14px] text-content placeholder:text-content-faint shadow-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-brand-ring)]"
        />
        <Button type="submit" disabled={creating || !composer.trim()}>
          Ask
        </Button>
      </form>
      {thread && messages.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-content-muted hover:text-content transition-colors"
        >
          View conversation ({messages.length})
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
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
// report: a masthead lockup at the top, the plan title set large in the
// editorial face over a thin brand accent rule in the vertical middle of the
// page, then "Prepared for {name}" + the date, and a quiet confidentiality
// line pinned to the foot. `.plan-print-cover` owns A4 page 1 alone (the print
// CSS forces the flex column to the full page height + the page break after).
function PrintCover({
  title,
  preparedFor,
  dateLabel,
  assumptions,
  soldProperties,
}: {
  title: string;
  preparedFor: string | null;
  dateLabel: string;
  assumptions: PlanAssumptions | null;
  soldProperties: { id: string; name: string; netEquity: number }[];
}) {
  const assumptionNote = assumptionLabels(assumptions, soldProperties);
  return (
    <div className="plan-print-only plan-print-cover">
      {/* Masthead lockup */}
      <div className="plan-cover-mast flex items-center gap-3">
        <BrandMark size={30} />
        <span className="font-editorial text-[17px] font-semibold leading-none tracking-[-0.01em] text-content">
          LasagnaFi
        </span>
      </div>

      {/* Title block, vertically centered on the page */}
      <div className="plan-cover-body">
        <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-content-muted">
          Financial Plan
        </div>
        <h1 className="mt-5 font-editorial text-[52px] font-bold leading-[1.02] tracking-[-0.03em] text-content">
          {title}
        </h1>
        {/* Thin brand accent rule */}
        <div className="plan-cover-rule mt-8" />
        {preparedFor && (
          <p className="mt-8 text-[16px] font-semibold text-content-secondary">
            Prepared for {preparedFor}
          </p>
        )}
        <p className="mt-1.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-content-muted ui-tnum">
          {dateLabel}
        </p>
        {/* Assumptions applied — discloses the basis of the printed figures so a
            saved PDF states its scenario. Only renders when assumptions are set. */}
        {assumptionNote.length > 0 && (
          <div className="mt-8">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-content-faint">
              Assumptions
            </div>
            <ul className="mt-2 space-y-1">
              {assumptionNote.map(({ key, label }) => (
                <li key={key} className="text-[13.5px] font-semibold text-content-secondary ui-tnum">
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Foot: quiet confidentiality line */}
      <div className="plan-cover-foot text-[10.5px] font-semibold uppercase tracking-[0.18em] text-content-faint">
        Prepared privately for the named recipient
      </div>
    </div>
  );
}

// ── Assumptions applied ───────────────────────────────────────────────────────

// One applied-assumption chip. `remove` is what the × sends to the assumptions
// PATCH to clear THIS chip: a scalar field cleared to null, or a specific sold
// property removed from the soldPropertyAccountIds list. `key` is a stable React
// key (also the pending-state token). Single-sourced so the on-screen chips and
// the print-only cover note read identically.
type AssumptionChip = {
  key: string;
  label: string;
  remove:
    | { [K in keyof PlanAssumptions]?: PlanAssumptions[K] | null }
    | { unsellPropertyAccountId: string };
};

// The active plan-change assumptions as chips. `soldProperties` (name + net
// equity, resolved server-side and carried on the snapshot) supplies the sold-
// property labels; assumptions alone only carry account ids.
function assumptionLabels(
  assumptions: PlanAssumptions | null,
  soldProperties: { id: string; name: string; netEquity: number }[] = [],
): AssumptionChip[] {
  if (!assumptions) return [];
  const chips: AssumptionChip[] = [];
  if (assumptions.includeSocialSecurity === false)
    chips.push({ key: "includeSocialSecurity", label: "Social Security excluded", remove: { includeSocialSecurity: null } });
  if (assumptions.retirementAge !== undefined)
    chips.push({ key: "retirementAge", label: `Retirement age ${assumptions.retirementAge}`, remove: { retirementAge: null } });
  if (assumptions.expectedReturn !== undefined)
    chips.push({
      key: "expectedReturn",
      label: `Assumes ${(assumptions.expectedReturn * 100).toFixed(assumptions.expectedReturn * 100 % 1 === 0 ? 0 : 1)}% returns`,
      remove: { expectedReturn: null },
    });
  if (assumptions.monthlySpend !== undefined)
    chips.push({ key: "monthlySpend", label: `Spending ${formatMoney(assumptions.monthlySpend, true)}/mo`, remove: { monthlySpend: null } });
  for (const p of soldProperties)
    chips.push({
      key: `sold:${p.id}`,
      label: `Sold ${p.name} (~${formatMoney(p.netEquity, true)} reinvested)`,
      remove: { unsellPropertyAccountId: p.id },
    });
  return chips;
}

// The active plan-change assumptions, as a small labeled row of removable chips
// in the cover zone. Each chip clears its own field (a PATCH that regenerates the
// plan) via the × affordance. Renders nothing when no assumptions are applied, so
// the report reads exactly as before. On-screen only — the print cover carries its
// own static assumptions note instead (chips are interactive, so they drop).
function AssumptionsApplied({
  assumptions,
  soldProperties,
  onRemove,
  pending,
}: {
  assumptions: PlanAssumptions | null;
  soldProperties: { id: string; name: string; netEquity: number }[];
  onRemove: (chip: AssumptionChip) => void;
  /** The chip key currently being cleared (its chip shows a busy, disabled state). */
  pending: string | null;
}) {
  const chips = assumptionLabels(assumptions, soldProperties);
  if (chips.length === 0) return null;

  return (
    <div className="plan-print-hide mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[12.5px] font-semibold text-content-muted">
        Assumptions applied
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => {
          const busy = pending === chip.key;
          return (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-panel py-0.5 pl-2.5 pr-1 text-[12.5px] font-semibold text-content-secondary shadow-ui-sm"
            >
              <span className="ui-tnum">{chip.label}</span>
              <button
                type="button"
                onClick={() => onRemove(chip)}
                disabled={busy}
                aria-label={`Remove: ${chip.label}`}
                className="-my-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-content-faint transition-colors hover:bg-canvas-sunken hover:text-content disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-brand-ring)]"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </span>
          );
        })}
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
  // The assumption chip currently being cleared (drives its busy state).
  const [removingAssumption, setRemovingAssumption] = useState<string | null>(null);
  // On-screen layout toggle (document vs wide), persisted to localStorage.
  const [layout, setLayout] = useState<ReportLayout>(readInitialLayout);
  const wide = layout === "wide";
  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, layout);
  }, [layout]);
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

  // After a chat turn, if the agent saved goals OR changed the plan's
  // assumptions (regenerating the document), refetch the plan so the Goals
  // section, the regenerated sections, and the "Assumptions applied" chips
  // reflect what was just written (no full page reload).
  const refreshAfterChat = (toolResults: ToolResult[]) => {
    if (!id) return;
    const wrote = toolResults.some(
      (t) =>
        t.toolName === "update_financial_plan_goals" ||
        t.toolName === "update_financial_plan_assumptions",
    );
    if (!wrote) return;
    api
      .getFinancialPlan(id)
      .then((p) => setPlan(p))
      .catch(() => {
        // Non-fatal: the next page load will show the saved changes.
      });
  };

  // Clear one applied assumption (the chip's × affordance): PATCH the chip's own
  // remove payload (a scalar field to null, or an unsell), which regenerates the
  // plan, then swap in the returned plan state.
  const removeAssumption = (chip: AssumptionChip) => {
    if (!id || removingAssumption) return;
    setRemovingAssumption(chip.key);
    api
      .updateFinancialPlanAssumptions(id, chip.remove)
      .then(() =>
        api.getFinancialPlan(id).then((p) => setPlan(p)),
      )
      .catch(() => {
        // Non-fatal: leave the chip; the next load reflects the true state.
      })
      .finally(() => setRemovingAssumption(null));
  };

  const snapshot = plan?.document?.sections?.snapshot ?? null;
  const portfolio = plan?.document?.sections?.portfolio ?? null;
  const retirement = plan?.document?.sections?.retirement ?? null;
  const whatIfs = plan?.document?.sections?.whatIfs ?? null;
  const goals = plan?.document?.sections?.goals ?? null;
  const suggestions = plan?.document?.sections?.suggestions ?? null;
  const narrative = plan?.document?.sections?.narrative ?? null;
  const strategy = plan?.document?.sections?.strategy ?? null;
  const schedule = plan?.document?.sections?.schedule ?? null;

  // Section numbers run sequentially over only the sections that actually
  // render, so there is never a gap in "01 02 03…" on plans missing the
  // conditional Income-sources / What-if sections.
  const hasIncomeSources = Boolean(themeBody(narrative, "income_sources"));
  const hasWhatIf = Boolean(whatIfs && whatIfs.scenarios.length > 0);
  const hasSchedule = Boolean(schedule?.computed);
  // When goals are unset, the Goals section is a hollow invitation, so it must
  // not lead the report or print. In that case it's rendered last on-screen as
  // an un-numbered CTA and dropped from print, so it never consumes a "01".
  const emptyGoals = goalsEmpty(goals);
  let sectionCount = 0;
  const nextSection = () => String(++sectionCount).padStart(2, "0");
  // The strategy zone opens the report, so its sub-sections consume the first
  // numbers; then the fixed leading sections, then the conditional ones in
  // render order. Suggestions are a legacy section fully superseded by the
  // strategy zone — suppressed whenever a strategy exists.
  const hasStrategy = Boolean(strategy);
  const watchNo = strategy && strategy.watchouts.length > 0 ? nextSection() : "";
  const strategyNo = strategy && strategy.strategies.length > 0 ? nextSection() : "";
  const exploreNo = strategy && strategy.explore.length > 0 ? nextSection() : "";
  const goalsNo = emptyGoals ? "" : nextSection();
  const snapshotNo = nextSection();
  const portfolioNo = nextSection();
  const retirementNo = nextSection();
  const scheduleNo = hasSchedule ? nextSection() : "";
  const incomeNo = hasIncomeSources ? nextSection() : "";
  const whatIfNo = hasWhatIf ? nextSection() : "";
  const suggestionsNo = hasStrategy ? "" : nextSection();

  // Exhibits are numbered "Exhibit 1, 2, 3…" globally across the whole document.
  // Numbers are computed here (not by a render-time counter threaded through
  // children, which drifts when a child re-renders on its own) from exactly the
  // figures that will render, in document order. Sub-components receive concrete
  // numbers so the sequence is deterministic and viewport-independent.
  const portfolioSegments = portfolio?.classes.filter((c) => c.value > 0).length ?? 0;
  const retirementComputed = retirement?.computed === true;
  const fig = {
    namedGoals: (goals?.namedGoals?.length ?? 0) > 0,
    assetsDebt: (snapshot?.breakdown.length ?? 0) > 0,
    byAssetType: portfolioSegments > 0,
    retirement: retirementComputed, // projected balance + withdrawal method
    drawdown: retirementComputed && (retirement?.drawdownOrder.length ?? 0) > 0,
    whatIf: hasWhatIf,
  };
  let exhibitCount = 0;
  const nextExhibit = () => ++exhibitCount;
  const exNamedGoals = fig.namedGoals ? nextExhibit() : 0;
  const exAssetsDebt = fig.assetsDebt ? nextExhibit() : 0;
  const exByAssetType = fig.byAssetType ? nextExhibit() : 0;
  const exProjectedBalance = fig.retirement ? nextExhibit() : 0;
  const exWithdrawalMethod = fig.retirement ? nextExhibit() : 0;
  const exDrawdownOrder = fig.drawdown ? nextExhibit() : 0;
  const exWhatIf = fig.whatIf ? nextExhibit() : 0;

  return (
    <div
      className={`plan-print-root mx-auto ${wide ? "max-w-[1180px] px-6 sm:px-11" : "max-w-[760px] px-6 sm:px-10"} pt-4 sm:pt-9 pb-6 sm:pb-28 text-content`}
    >
      <button
        onClick={() => navigate("/financial-plans")}
        className="plan-print-hide inline-flex items-center gap-1.5 text-[13px] font-semibold text-content-muted hover:text-content transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Retirement Plans
      </button>

      {/* ════════ Loading ════════ */}
      {loading && (
        <div className="mt-6">
          <Skeleton className="h-11 w-2/3" />
          <Skeleton className="mt-4 h-4 w-1/3" />
          <Skeleton className="mt-8 h-11 w-full" />
          <Skeleton className="mt-12 h-4 w-1/4" />
          <Skeleton className="mt-4 h-24 w-full" />
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

      {/* ════════ Freeform advisor report (experiment) ════════ */}
      {!loading && !error && plan && plan.document?.freeform && (
        <>
          {/* The report's own masthead (inside the iframe) is the single brand
              statement — the page chrome must not repeat it. An app-side title
              renders only when the plan carries a CUSTOM name that adds
              information beyond the default. */}
          {plan.title.trim().toLowerCase() !== "financial insights" && (
            <div className="mt-6 sm:mt-9">
              <h1 className="font-serif text-[34px] leading-[1.08] tracking-[-0.015em] text-content sm:text-[40px]">
                {plan.title}
              </h1>
            </div>
          )}
          <FreeformReportView
            planId={plan.id}
            planTitle={plan.title}
            report={plan.document.freeform}
            onRevised={(doc) => setPlan((prev) => (prev ? { ...prev, document: doc } : prev))}
          />
        </>
      )}

      {/* ════════ Document ════════ */}
      {!loading && !error && plan && !plan.document?.freeform && snapshot && (
        <>
          {/* Branded cover — print only. */}
          <PrintCover
            title={plan.title}
            preparedFor={user?.name ?? null}
            dateLabel={planCoverDate(snapshot.generatedAt)}
            assumptions={plan.assumptions}
            soldProperties={snapshot.soldProperties ?? []}
          />

          {/* ── Masthead + chat: one "cover" zone, closed by a rule ──
              Entirely on-screen: the print cover replaces the masthead and the
              chat is interactive, so the whole zone (and its closing rule) is
              dropped in print to avoid an orphan rule atop the printed body. */}
          <div className="plan-print-hide border-b border-line pb-8">
            {/* On-screen masthead + the Download PDF action (hidden in print so
                it doesn't double with the cover). */}
            <header className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:hidden">
              <div className="min-w-0">
                <h1 className="font-editorial text-[34px] sm:text-[46px] font-bold leading-[1.03] tracking-[-0.028em] text-content">
                  {plan.title}
                </h1>
                <p className="mt-3 text-[14px] font-semibold text-content-muted ui-tnum">
                  {planByline(user?.name ?? null, snapshot.generatedAt)}
                </p>
                <AssumptionsApplied
                  assumptions={plan.assumptions}
                  soldProperties={snapshot.soldProperties ?? []}
                  onRemove={removeAssumption}
                  pending={removingAssumption}
                />
              </div>
              <div className="plan-print-hide flex items-center gap-2 self-start shrink-0">
                {/* Wide === Document below lg (no side-by-side room), so the
                    toggle only appears from lg up where it changes anything. */}
                <div className="hidden lg:inline-flex">
                  <SegmentedControl<ReportLayout>
                    size="sm"
                    stretch={false}
                    aria-label="Plan layout"
                    value={layout}
                    onChange={setLayout}
                    options={[
                      { value: "document", label: "Document" },
                      { value: "wide", label: "Wide" },
                    ]}
                  />
                </div>
                <Button
                  variant="secondary"
                  leadingIcon={<Download className="h-4 w-4" />}
                  onClick={printPlanToPdf}
                >
                  Download PDF
                </Button>
              </div>
            </header>

            {/* Chat about this plan — the entry point, at the very top. Grounded
                in the sections below. Also the surface where the Goals CTA seeds
                the goals intake. Interactive, so it's dropped from the printed
                report. */}
            {id && (
              <div className="plan-print-hide">
                <PlanChat
                  planId={id}
                  seed={{ n: goalsSeed, prompt: GOALS_INTAKE_PROMPT }}
                  onChatResponse={refreshAfterChat}
                  chatRef={chatRef}
                />
              </div>
            )}
          </div>

          {/* Strategy section — LLM strategist output (new-engine plans only).
              Absent on legacy plans (which carry narrative/suggestions). Renders
              right after the chat cover zone so the report opens with strategy. */}
          <StrategySectionView
            strategy={strategy}
            watchNo={watchNo}
            strategyNo={strategyNo}
            exploreNo={exploreNo}
          />

          {/* Executive summary — the prose lead of the report, right after the
              cover zone. Absent on plans with no narrative (old plans, or a
              failed create-time gen), in which case nothing renders and the
              report reads exactly as before. */}
          {narrative?.executiveSummary?.trim() && (
            <div className="plan-exec-summary mt-10">
              <div className={`plan-prose ${wide ? "max-w-[760px]" : "max-w-[620px]"} space-y-3.5`}>
                {splitParagraphs(narrative.executiveSummary)
                  .map((p, i) => (
                    <p
                      key={i}
                      className="text-[16.5px] leading-[1.55] tracking-[-0.01em] text-content"
                    >
                      {p}
                    </p>
                  ))}
              </div>
            </div>
          )}

          {/* Goals section — the user's stated intent frames the plan, so it
              leads when set. When unset it's a hollow invitation, so it's moved
              after the computed sections (and dropped from print) rather than
              opening the report on an empty section. */}
          {!emptyGoals && (
            <GoalsSectionView
              goals={goals}
              onComplete={() => setGoalsSeed((n) => n + 1)}
              sectionNo={goalsNo}
              namedGoalsExhibit={exNamedGoals}
              wide={wide}
            />
          )}

          {/* Financial Snapshot section.
              DOM order is fixed (situation lede, KPI band, monthly line, then the
              assets-vs-debt figure) so the printed document is identical in BOTH
              toggle states. In Wide, a 12-col grid *re-places* those same nodes
              via row/col placement (not reorder in the DOM): band 1 = KPIs +
              monthly spanning the frame; band 2 = lede (cols 1-5) beside the
              figure (cols 7-12). The grid only wires up in Wide and collapses in
              print, so Document/mobile/PDF read as the plain stack, unchanged. */}
          <ReportSection n={snapshotNo} label="Financial snapshot">
            <div className={wide ? "plan-wide-grid lg:grid lg:grid-cols-12 lg:gap-x-14 lg:items-start" : ""}>
            {/* Situation prose lede (band 2 left in Wide; leads the section in
                Document/print). Skipped entirely when the plan has no narrative
                (strategy-era plans), so the figure takes the row instead of
                sitting beside an empty column. */}
            {themeBody(narrative, "situation") && (
              <div className={wide ? "lg:col-start-1 lg:col-span-5 lg:row-start-2" : ""}>
                <ThemeLede
                  body={themeBody(narrative, "situation")}
                  className={wide ? "lg:max-w-[520px]" : ""}
                />
              </div>
            )}

            {/* Band 1: net-worth headline + KPI 3-up + monthly line. */}
            <div className={wide ? "lg:col-span-12 lg:row-start-1" : ""}>
            {/* Net worth headline + supporting KPIs as borderless rows. */}
            <div className={`mt-6 ${wide ? "" : "max-w-[720px]"} grid grid-cols-1 divide-y divide-line min-[640px]:grid-cols-3 min-[640px]:divide-x min-[640px]:divide-y-0`}>
              <div className="py-4 min-[640px]:py-0 min-[640px]:pr-6">
                <Stat label="Net worth" value={formatMoney(snapshot.netWorth, true)} />
              </div>
              <div className="py-4 min-[640px]:py-0 min-[640px]:px-6">
                <Stat label="Total assets" value={formatMoney(snapshot.totalAssets, true)} />
              </div>
              <div className="py-4 min-[640px]:py-0 min-[640px]:pl-6">
                <Stat label="Total debt" value={formatMoney(snapshot.totalDebt, true)} />
              </div>
            </div>

            {/* Monthly spending / income line — quiet prose, not a card. */}
            <p className="mt-6 max-w-[720px] text-[13.5px] text-content-muted ui-tnum">
              Monthly spending {formatMoney(snapshot.monthlySpend, true)} (previous calendar month)
              {snapshot.annualIncome != null && (
                <>, annual income {formatMoney(snapshot.annualIncome, true)}</>
              )}
              {snapshot.age != null && <>, age {snapshot.age}</>}
            </p>
            </div>

            {/* Band 2 right (Wide): the assets-vs-debt figure. Without a lede it
                starts at col 1 (ragged-right, no left void). */}
            <div
              className={
                wide
                  ? themeBody(narrative, "situation")
                    ? "lg:col-start-7 lg:col-span-6 lg:row-start-2"
                    : "lg:col-start-1 lg:col-span-8 lg:row-start-2"
                  : ""
              }
            >
            {/* Assets vs debt visual */}
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
                        {formatMoney(total, true)}
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
                  <Figure n={exAssetsDebt} title="Assets vs debt" wide={wide} caption="Both bars share one dollar scale, so the gap reads as net worth.">
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
                            {formatMoney(b.value, true)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Figure>
                );
              })()
            ) : (
              <p className="mt-6 max-w-[660px] text-[14.5px] leading-[1.56] text-content-muted">
                No account balances to break down yet. Link accounts to see assets vs debt.
              </p>
            )}
            </div>
            </div>
          </ReportSection>

          {/* Portfolio Composition section — absent on plans created before it
              shipped, in which case we recompute nothing and show the prose
              empty state so old plans never crash. */}
          <PortfolioCompositionSection
            sectionNo={portfolioNo}
            byAssetTypeExhibit={exByAssetType}
            wide={wide}
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
              shipped, in which case we show the un-computed prose state so old
              plans never crash. */}
          <RetirementReadinessSectionView
            sectionNo={retirementNo}
            projectedBalanceExhibit={exProjectedBalance}
            withdrawalMethodExhibit={exWithdrawalMethod}
            drawdownOrderExhibit={exDrawdownOrder}
            wide={wide}
            lede={<ThemeLede body={themeBody(narrative, "retirement_readiness")} className={wide ? "lg:max-w-[520px]" : ""} />}
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

          {/* Cashflow & drawdown schedule — deterministic year-by-year engine
              output (new-engine plans only). Absent on legacy plans. Placed
              right after Retirement Readiness so the year-by-year detail
              follows the odds summary. */}
          <ScheduleTableView
            schedule={schedule}
            sectionNo={scheduleNo}
            arithmeticReturn={retirement?.computed ? retirement.blendedExpectedReturn : null}
          />

          {/* Income sources — a prose block on how Social Security, rental
              income, and property equity layer with portfolio withdrawals to
              fund retirement. Placed by Retirement since these are retirement
              income. Renders only when the narrative produced the theme. */}
          {hasIncomeSources && (
            <ReportSection n={incomeNo} label="Income sources">
              <ThemeLede body={themeBody(narrative, "income_sources")} />
            </ReportSection>
          )}

          {/* What-if scenarios — deterministic re-runs of the SAME engine with
              overrides, each shown as a delta vs the base success rate. Absent
              on plans created before it shipped (and when the base wasn't
              computable), so we render it only when the section exists rather
              than showing an empty state on old plans. */}
          {hasWhatIf && whatIfs && (
            <WhatIfSectionView
              whatIfs={whatIfs}
              sectionNo={whatIfNo}
              scenariosExhibit={exWhatIf}
              wide={wide}
              lede={<ThemeLede body={themeBody(narrative, "whatifs")} className={wide ? "lg:max-w-[520px]" : ""} />}
            />
          )}

          {/* Suggestions section — legacy LLM next steps. Fully superseded by the
              strategy zone, so it renders only on plans WITHOUT a strategy
              section (created before the report engine shipped). */}
          {!hasStrategy && (
            <SuggestionsSectionView
              suggestions={suggestions}
              sectionNo={suggestionsNo}
              wide={wide}
              lede={
                <>
                  <ThemeLede body={themeBody(narrative, "risks_opportunities")} />
                  <ThemeLede body={themeBody(narrative, "recommendations")} />
                </>
              }
            />
          )}

          {/* Goals invitation — only when unset. An un-numbered CTA at the foot
              of the on-screen report so it never leads; the whole block is
              print-hidden so the static PDF shows no "ask in chat" copy. */}
          {emptyGoals && (
            <div className="plan-print-hide">
              <GoalsSectionView
                goals={goals}
                onComplete={() => setGoalsSeed((n) => n + 1)}
                sectionNo={goalsNo}
                namedGoalsExhibit={exNamedGoals}
                wide={wide}
              />
            </div>
          )}

          {/* Legal disclaimer — print only, closes the report. Reuses the
              projections copy so it stays single-sourced with the app. The
              running page footer is drawn in the @page margin boxes (index.css),
              not as an in-flow element. */}
          <p className="plan-print-only mt-12 border-t border-line pt-6 text-center text-[11px] leading-[1.5] text-content-muted">
            {DISCLAIMER_COPY.projections}
          </p>
        </>
      )}
    </div>
  );
}
