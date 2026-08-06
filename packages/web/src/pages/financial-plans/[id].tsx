import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, FileText, Download } from "lucide-react";
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
  NarrativeSection,
  NarrativeThemeKey,
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

// The byline under the masthead + on the print cover, single-sourced so screen
// and PDF read identically. Middot separator per UX.md (not a dash).
function planByline(userName: string | null, generatedAt: string): string {
  const date = new Date(generatedAt).toLocaleDateString();
  return userName ? `Prepared for ${userName} · Generated ${date}` : `Generated ${date}`;
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

// A numbered section head: a thin top rule across the full 720 rail, then the
// numeral in the editorial face + the section name as a tracked muted label.
// Replaces the old accent-dot eyebrows. Prose/body is constrained by callers to
// ~65ch; wide figures fill the rail.
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
    <section className="mt-12 sm:mt-14 border-t border-line pt-10">
      <div className="flex items-baseline gap-3">
        <span className="font-editorial text-[15px] font-bold leading-none text-content-faint ui-tnum">
          {n}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-content-muted">
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
}: {
  n: number;
  title: string;
  caption?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <figure className="plan-figure mt-6 border-t border-line pt-5">
      <figcaption className="flex items-baseline gap-2.5">
        <span className="font-editorial text-[13px] font-bold leading-none text-content-faint ui-tnum">
          Exhibit {n}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-content-muted">
          {title}
        </span>
      </figcaption>
      <div className="mt-4">{children}</div>
      {caption && <p className="mt-2 text-[12.5px] leading-[1.5] text-content-muted">{caption}</p>}
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
function ThemeLede({ body }: { body: string | null }) {
  if (!body) return null;
  const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="plan-prose mt-4 max-w-[620px] space-y-3">
      {paras.map((p, i) => (
        <p key={i} className="text-[15.5px] leading-[1.72] text-content-secondary">
          {p}
        </p>
      ))}
    </div>
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

// Verdict colors, mirroring retirement-v2.tsx's compositeColor/compositeBg
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

function RetirementReadinessSectionView({
  section,
  lede,
  sectionNo,
  projectedBalanceExhibit,
  withdrawalMethodExhibit,
  drawdownOrderExhibit,
}: {
  section: RetirementReadinessSection;
  lede?: React.ReactNode;
  sectionNo: string;
  projectedBalanceExhibit: number;
  withdrawalMethodExhibit: number;
  drawdownOrderExhibit: number;
}) {
  if (!section.computed) {
    return (
      <ReportSection n={sectionNo} label="Retirement readiness">
        <p className="mt-4 max-w-[620px] text-[15.5px] leading-[1.72] text-content-muted">
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
      {lede}

      {/* Verdict as a restrained left-rule pull-quote, not a loud card. */}
      <div
        className="mt-6 max-w-[620px] rounded-ui-md py-4 pl-5 pr-4"
        style={{ background: style.bg, borderLeft: `3px solid ${style.ink}` }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-[20px] font-bold leading-none" style={{ color: style.ink }}>
            {VERDICT_LABEL[section.verdict]}
          </span>
          <span className="ui-tnum text-[20px] font-bold leading-none" style={{ color: style.ink }}>
            {section.successRate}%
          </span>
        </div>
        <p className="mt-2 text-[14px] leading-[1.6] text-content-secondary">
          Odds your money lasts {lastsThrough}, retiring at {section.retirementAge}. Target is{" "}
          {section.targetSuccess}%.
        </p>
      </div>

      {/* Projected growth: median + 25th-75th band, split at retirement. */}
      <Figure
        n={projectedBalanceExhibit}
        title="Projected balance"
        caption={
          <>
            Median with the 25th to 75th percentile band, split at retirement.
            {section.blendedExpectedReturn > 0 && (
              <> {(section.blendedExpectedReturn * 100).toFixed(1)}% blended expected return.</>
            )}
          </>
        }
      >
        <div className="rounded-ui-md bg-canvas-sunken/50 p-5">
          <GrowthChart section={section} />
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
      </Figure>

      {/* Drawdown method comparison: the recommended optimal is marked. */}
      <Figure
        n={withdrawalMethodExhibit}
        title="Withdrawal method"
        caption="How you draw the portfolio down changes how long it lasts. Each method run on your plan."
      >
        <ul className="divide-y divide-line">
          {section.methods.map((m) => (
            <li
              key={m.strategy}
              className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
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
      </Figure>

      {/* Drawdown order: the tax-treatment spending sequence. */}
      {section.drawdownOrder.length > 0 && (
        <Figure
          n={drawdownOrderExhibit}
          title="Drawdown order"
          caption="Which accounts to spend first in retirement, most tax-efficient first."
        >
          <ol className="divide-y divide-line">
            {section.drawdownOrder.map((u, i) => (
              <li key={u.bucket} className="flex items-center justify-between gap-3 py-3">
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
        </Figure>
      )}
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
}: {
  whatIfs: WhatIfSection;
  lede?: React.ReactNode;
  scenariosExhibit: number;
  sectionNo: string;
}) {
  return (
    <ReportSection n={sectionNo} label="What if?">
      {lede}
      <Figure
        n={scenariosExhibit}
        title="Try a different plan"
        caption={`Each scenario re-runs your plan with one change, compared to your base success rate of ${whatIfs.baseSuccessRate}%.`}
      >
        <ul className="divide-y divide-line">
          {whatIfs.scenarios.map((s) => (
            <li
              key={s.label}
              className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-[14px] font-bold text-content">{s.label}</span>
              <span className="flex shrink-0 items-center gap-2.5 whitespace-nowrap sm:justify-end ui-tnum">
                <span className="text-[14px] font-bold text-content">{s.successRate}%</span>
                <DeltaBadge delta={s.deltaVsBase} />
              </span>
            </li>
          ))}
        </ul>
      </Figure>
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
  sectionNo,
  namedGoalsExhibit,
}: {
  goals: GoalsSection | null;
  onComplete: () => void;
  sectionNo: string;
  namedGoalsExhibit: number;
}) {
  // Fully empty: a left-rule prose invitation, no half-filled rows to clutter it.
  if (goalsEmpty(goals)) {
    return (
      <ReportSection n={sectionNo} label="Goals">
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="max-w-[540px] border-l-[3px] border-line-strong pl-4 text-[15.5px] leading-[1.72] text-content-secondary">
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
      <div className="mt-6 grid grid-cols-1 divide-y divide-line min-[640px]:grid-cols-3 min-[640px]:divide-x min-[640px]:divide-y-0">
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
        <Figure n={namedGoalsExhibit} title="Named goals">
          <ul className="divide-y divide-line">
            {named.map((g, i) => (
              <li
                key={`${g.label}-${i}`}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
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
}: {
  suggestions: SuggestionsSection | null;
  lede?: React.ReactNode;
  sectionNo: string;
}) {
  const items = suggestions?.items ?? [];

  return (
    <ReportSection n={sectionNo} label="Suggestions">
      {lede}
      {items.length === 0 ? (
        <p className="mt-4 max-w-[620px] text-[15.5px] leading-[1.72] text-content-muted">
          No suggestions yet.{" "}
          <span className="plan-print-hide">
            Ask in chat for concrete next steps, or create a new plan once your accounts are linked.
          </span>
        </p>
      ) : (
        <ol className="mt-6">
          {items.map((s, i) => (
            <li key={`${s.title}-${i}`} className="border-t border-line pt-5 mt-5 first:mt-0">
              <div className="flex items-start justify-between gap-3">
                <h3 className="flex items-baseline gap-2.5 text-[16px] font-bold text-content">
                  <span className="font-editorial text-[14px] leading-none text-content-faint ui-tnum">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{s.title}</span>
                </h3>
                {s.category && (
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[rgb(var(--ui-brand-ink))] bg-brand-soft">
                    {s.category}
                  </span>
                )}
              </div>
              <p className="mt-2 max-w-[620px] text-[15px] leading-[1.65] text-content-secondary">
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

// ── Portfolio ─────────────────────────────────────────────────────────────────

// Portfolio Composition — the top-level asset-type split as one shared-scale bar
// plus a grouped, de-duped breakdown (each class, then its de-duplicated category
// lines). Values come straight from aggregatePortfolio via the stored section.
function PortfolioCompositionSection({
  portfolio,
  sectionNo,
  byAssetTypeExhibit,
}: {
  portfolio: PortfolioSection;
  sectionNo: string;
  byAssetTypeExhibit: number;
}) {
  const segments = portfolio.classes.filter((c) => c.value > 0);

  return (
    <ReportSection n={sectionNo} label="Portfolio composition">
      {segments.length === 0 ? (
        <p className="mt-4 max-w-[620px] text-[15.5px] leading-[1.72] text-content-muted">
          No investment holdings are linked. Link an investment account to see how your portfolio
          breaks down by asset type.
        </p>
      ) : (
        <Figure
          n={byAssetTypeExhibit}
          title="By asset type"
          caption={`Total portfolio value ${formatMoney(portfolio.totalValue)}.`}
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

  const header = (
    <div>
      <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-content-muted">
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

  return (
    <div ref={chatRef} className="mt-8 scroll-mt-6">
      {header}
      {thread ? (
        // Existing / active thread: expand the transcript inline. Wrap ChatPanel
        // in a thin --ui-* container so its legacy chrome doesn't clash with the
        // paper ground.
        <div className="mt-3 max-h-[440px] overflow-hidden rounded-ui-md border border-line-strong bg-panel shadow-ui-sm">
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
      ) : (
        // Resting state: a quiet composer, not a slab. Same DS focus idiom as the
        // rest of the app.
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startThread(composer);
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
// report: wordmark, plan title, whose plan it is, and the generated date.
function PrintCover({
  title,
  byline,
}: {
  title: string;
  byline: string;
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
        <p className="mt-4 text-[14px] font-semibold text-content-muted ui-tnum">{byline}</p>
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
  const narrative = plan?.document?.sections.narrative ?? null;

  // Section numbers run sequentially over only the sections that actually
  // render, so there is never a gap in "01 02 03…" on plans missing the
  // conditional Income-sources / What-if sections.
  const hasIncomeSources = Boolean(themeBody(narrative, "income_sources"));
  const hasWhatIf = Boolean(whatIfs && whatIfs.scenarios.length > 0);
  let sectionCount = 0;
  const nextSection = () => String(++sectionCount).padStart(2, "0");
  // Fixed leading sections, then the conditional ones in render order.
  const goalsNo = nextSection();
  const snapshotNo = nextSection();
  const portfolioNo = nextSection();
  const retirementNo = nextSection();
  const incomeNo = hasIncomeSources ? nextSection() : "";
  const whatIfNo = hasWhatIf ? nextSection() : "";
  const suggestionsNo = nextSection();

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
    <div className="plan-print-root mx-auto max-w-[720px] px-5 sm:px-8 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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

      {/* ════════ Document ════════ */}
      {!loading && !error && plan && snapshot && (
        <>
          {/* Branded cover — print only. */}
          <PrintCover
            title={plan.title}
            byline={planByline(user?.name ?? null, snapshot.generatedAt)}
          />

          {/* ── Masthead + chat: one "cover" zone, closed by a rule ── */}
          <div className="border-b border-line pb-8">
            {/* On-screen masthead + the Download PDF action (hidden in print so
                it doesn't double with the cover). */}
            <header className="mt-6 flex items-start justify-between gap-4 print:hidden">
              <div className="min-w-0">
                <div className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-content-muted">
                  Financial Plan
                </div>
                <h1 className="mt-2 font-editorial text-[34px] sm:text-[46px] font-bold leading-[1.03] tracking-[-0.028em] text-content">
                  {plan.title}
                </h1>
                <p className="mt-3 text-[14px] font-semibold text-content-muted ui-tnum">
                  {planByline(user?.name ?? null, snapshot.generatedAt)}
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

            {/* Chat about this plan — the entry point, at the very top. Grounded
                in the sections below. Also the surface where the Goals CTA seeds
                the goals intake. Interactive, so it's dropped from the printed
                report. */}
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
          </div>

          {/* Executive summary — the prose lead of the report, right after the
              cover zone. Absent on plans with no narrative (old plans, or a
              failed create-time gen), in which case nothing renders and the
              report reads exactly as before. */}
          {narrative?.executiveSummary?.trim() && (
            <div className="plan-exec-summary mt-10">
              <div className="plan-prose max-w-[620px] space-y-4">
                {narrative.executiveSummary
                  .split(/\n+/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p, i) => (
                    <p
                      key={i}
                      className="text-[17px] sm:text-[18px] leading-[1.6] tracking-[-0.005em] text-content"
                    >
                      {p}
                    </p>
                  ))}
              </div>
            </div>
          )}

          {/* Goals section — the user's stated intent frames the plan, so it
              leads. Its CTA seeds the plan chat's goals intake above. */}
          <GoalsSectionView
            goals={goals}
            onComplete={() => setGoalsSeed((n) => n + 1)}
            sectionNo={goalsNo}
            namedGoalsExhibit={exNamedGoals}
          />

          {/* Financial Snapshot section */}
          <ReportSection n={snapshotNo} label="Financial snapshot">
            {/* Situation prose lede atop the snapshot exhibits. */}
            <ThemeLede body={themeBody(narrative, "situation")} />

            {/* Net worth headline + supporting KPIs as borderless rows. */}
            <div className="mt-6 grid grid-cols-1 divide-y divide-line min-[640px]:grid-cols-3 min-[640px]:divide-x min-[640px]:divide-y-0">
              <div className="py-4 min-[640px]:py-0 min-[640px]:pr-6">
                <Stat label="Net worth" value={formatMoney(snapshot.netWorth)} />
              </div>
              <div className="py-4 min-[640px]:py-0 min-[640px]:px-6">
                <Stat
                  label="Total assets"
                  value={formatMoney(snapshot.totalAssets)}
                  caption="Across your linked accounts"
                />
              </div>
              <div className="py-4 min-[640px]:py-0 min-[640px]:pl-6">
                <Stat
                  label="Total debt"
                  value={formatMoney(snapshot.totalDebt)}
                  caption="Credit and loans"
                />
              </div>
            </div>

            {/* Monthly spending / income line — quiet prose, not a card. */}
            <p className="mt-6 max-w-[620px] text-[13.5px] text-content-muted ui-tnum">
              Monthly spending {formatMoney(snapshot.monthlySpend)} (previous calendar month)
              {snapshot.annualIncome != null && (
                <> · Annual income {formatMoney(snapshot.annualIncome)}</>
              )}
              {snapshot.age != null && <> · Age {snapshot.age}</>}
            </p>

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
                  <Figure n={exAssetsDebt} title="Assets vs debt" caption="Both bars share one dollar scale; the gap reads as net worth.">
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
                  </Figure>
                );
              })()
            ) : (
              <p className="mt-6 max-w-[620px] text-[15.5px] leading-[1.72] text-content-muted">
                No account balances to break down yet. Link accounts to see assets vs debt.
              </p>
            )}
          </ReportSection>

          {/* Portfolio Composition section — absent on plans created before it
              shipped, in which case we recompute nothing and show the prose
              empty state so old plans never crash. */}
          <PortfolioCompositionSection
            sectionNo={portfolioNo}
            byAssetTypeExhibit={exByAssetType}
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
            lede={<ThemeLede body={themeBody(narrative, "retirement_readiness")} />}
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
              lede={<ThemeLede body={themeBody(narrative, "whatifs")} />}
            />
          )}

          {/* Suggestions section — LLM-generated next steps grounded in the
              plan's real figures. The narrative's risks/opportunities and
              recommendations prose lead into it. Absent on plans created before
              it shipped or when the create-time model call failed; shows a quiet
              prose empty state in that case. */}
          <SuggestionsSectionView
            suggestions={suggestions}
            sectionNo={suggestionsNo}
            lede={
              <>
                <ThemeLede body={themeBody(narrative, "risks_opportunities")} />
                <ThemeLede body={themeBody(narrative, "recommendations")} />
              </>
            }
          />

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
