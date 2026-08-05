import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, FileText } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button, Stat, Skeleton, EmptyState } from "../../components/uikit";
import { vizColor } from "../../components/uikit/viz.js";
import { formatMoney } from "../../lib/utils.js";
import type { FinancialPlan, FinancialSnapshotBreakdownItem } from "../../lib/types.js";

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

export function FinancialPlanDetailPage() {
  const [, params] = useRoute("/financial-plans/:id");
  const [, navigate] = useLocation();
  const id = params?.id;

  const [plan, setPlan] = useState<FinancialPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"notfound" | "generic" | null>(null);

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

  const snapshot = plan?.document?.sections.snapshot ?? null;

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <button
        onClick={() => navigate("/financial-plans")}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-content-muted hover:text-content transition-colors"
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
          <header className="mt-6">
            <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
              {plan.title}
            </h1>
            <p className="mt-2 text-[14px] font-semibold text-content-muted ui-tnum">
              Generated {new Date(snapshot.generatedAt).toLocaleDateString()}
            </p>
          </header>

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
        </>
      )}
    </div>
  );
}
