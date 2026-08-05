import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Loader2, Trash2, FileText, ChevronRight } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button, Skeleton, EmptyState } from "../../components/uikit";
import type { FinancialPlanSummary } from "../../lib/types.js";

export function FinancialPlansPage() {
  const [plans, setPlans] = useState<FinancialPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    api
      .listFinancialPlans()
      .then(({ plans }) => setPlans(plans))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { plan } = await api.createFinancialPlan();
      navigate(`/financial-plans/${plan.id}`);
    } catch {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, title: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete '${title}'? This will archive the plan.`)) return;
    setDeletingId(id);
    try {
      await api.deleteFinancialPlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch {
      alert("Failed to delete plan. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Financial Plans
          </h1>
          {!loading && !error && plans.length > 0 && (
            <p className="mt-2 max-w-[52ch] text-[14.5px] font-semibold text-content-muted">
              A saved snapshot of your net worth, assets vs debt, and monthly spending, built from
              your real accounts.
            </p>
          )}
        </div>
        {!loading && !error && plans.length > 0 && (
          <Button
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating…" : "New plan"}
          </Button>
        )}
      </header>

      {/* ════════ Loading ════════ */}
      {loading && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="mt-4 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* ════════ Error ════════ */}
      {!loading && error && (
        <div className="mt-8">
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="Couldn't load your plans"
            description="Something went wrong fetching your financial plans. Please try again."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setError(false);
                  setLoading(true);
                  api
                    .listFinancialPlans()
                    .then(({ plans }) => setPlans(plans))
                    .catch(() => setError(true))
                    .finally(() => setLoading(false));
                }}
              >
                Retry
              </Button>
            }
          />
        </div>
      )}

      {/* ════════ Empty ════════ */}
      {!loading && !error && plans.length === 0 && (
        <div className="mt-8">
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No plans yet"
            description="Create your first plan and Lasagna drafts a Financial Snapshot from your real accounts."
            action={
              <Button
                leadingIcon={<Plus className="h-4 w-4" />}
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? "Creating…" : "Create a plan"}
              </Button>
            }
          />
        </div>
      )}

      {/* ════════ List ════════ */}
      {!loading && !error && plans.length > 0 && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {plans.map((plan) => (
            <Link key={plan.id} href={`/financial-plans/${plan.id}`} className="ui-focus rounded-ui-xl">
              <article className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong">
                {/* left accent rail — matches the /plans card idiom */}
                <span
                  className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-brand))]"
                  aria-hidden
                />
                <button
                  onClick={(e) => handleDelete(plan.id, plan.title, e)}
                  disabled={deletingId === plan.id}
                  className="absolute top-2 right-2 sm:top-3.5 sm:right-3.5 grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-ui-sm text-content-faint opacity-100 sm:opacity-0 transition-[opacity,color,background] hover:bg-negative-soft hover:text-negative group-hover:opacity-100 disabled:opacity-50"
                  aria-label="Delete plan"
                >
                  {deletingId === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>

                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ui-md bg-brand-soft text-brand">
                  <FileText className="h-[22px] w-[22px]" />
                </span>

                <h3 className="mt-4 font-editorial text-[19px] font-bold leading-[1.25] tracking-[-0.015em] text-content line-clamp-2">
                  {plan.title}
                </h3>

                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-content-muted">
                    <span className="inline-flex items-center rounded-full bg-canvas-sunken px-2 py-0.5 text-[11px] font-bold capitalize text-content-secondary">
                      {plan.status}
                    </span>
                    <span className="ui-tnum">
                      Created {new Date(plan.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-bold text-content-muted transition-colors group-hover:text-[rgb(var(--ui-brand-ink))]">
                    View
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
