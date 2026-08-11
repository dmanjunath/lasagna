import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, Loader2, Trash2, FileText, ChevronRight, Pencil, Check } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button, Skeleton, EmptyState, Modal } from "../../components/uikit";
import type { FinancialPlanSummary } from "../../lib/types.js";

// Default report name, versioned against the existing list so each new report
// gets a distinct, editable name ("Financial Insights", then "… v2", "… v3").
function defaultReportName(plans: FinancialPlanSummary[]): string {
  const existing = plans.filter((p) =>
    p.title.trim().toLowerCase().startsWith("financial insights"),
  ).length;
  return existing === 0 ? "Financial Insights" : `Financial Insights v${existing + 1}`;
}

/**
 * The Financial Insights report list — cards with rename/delete and the
 * name-only "New report" modal. Self-contained (fetches its own data) so it can
 * render both as the standalone /financial-plans page and inside the
 * Retirement page's "Financial Reports" tab.
 */
export function FinancialPlansList() {
  const [plans, setPlans] = useState<FinancialPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, navigate] = useLocation();

  // Rename-in-place state: which card is editing, and the draft value.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // Name-only creation (reports are always Financial Insights).
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const load = () => {
    setError(false);
    setLoading(true);
    api
      .listFinancialPlans()
      .then(({ plans }) => setPlans(plans))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    if (creating) return;
    setNameDraft(defaultReportName(plans));
    setCreateError(null);
    setNameOpen(true);
  };

  const create = async () => {
    if (creating) return;
    const title = nameDraft.trim();
    if (!title) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { plan } = await api.createFinancialPlan(title, "freeform");
      navigate(`/financial-plans/${plan.id}`);
    } catch (e) {
      setCreateError(
        e instanceof Error && e.message ? e.message : "Could not create the report. Try again.",
      );
      setCreating(false);
    }
  };

  const startRename = (plan: FinancialPlanSummary, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingId(plan.id);
    setRenameDraft(plan.title);
  };

  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    if (!id || savingRename) return;
    const prev = plans.find((p) => p.id === id);
    if (!title || !prev || title === prev.title) {
      setRenamingId(null);
      return;
    }
    setSavingRename(true);
    try {
      await api.renameFinancialPlan(id, title);
      setPlans((list) => list.map((p) => (p.id === id ? { ...p, title } : p)));
      setRenamingId(null);
    } catch {
      // keep the editor open so the user can retry or escape
    } finally {
      setSavingRename(false);
    }
  };

  const handleDelete = async (id: string, title: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Delete '${title}'? This will archive the report.`)) return;
    setDeletingId(id);
    try {
      await api.deleteFinancialPlan(id);
      setPlans((prev) => prev.filter((p) => p.id !== id));
    } catch {
      alert("Failed to delete the report. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      {/* ════════ Loading ════════ */}
      {loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
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
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="Couldn't load your reports"
          description="Something went wrong fetching your reports. Please try again."
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      )}

      {/* ════════ Empty ════════ */}
      {!loading && !error && plans.length === 0 && (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No reports yet"
          description="Create your first Financial Insights report, a complete written analysis built from your real accounts."
          action={
            <Button
              leadingIcon={<Plus className="h-4 w-4" />}
              onClick={openCreate}
              disabled={creating}
            >
              {creating ? "Creating…" : "New report"}
            </Button>
          }
        />
      )}

      {/* ════════ List ════════ */}
      {!loading && !error && plans.length > 0 && (
        <>
          <div className="mb-5 flex justify-end">
            <Button
              leadingIcon={<Plus className="h-4 w-4" />}
              onClick={openCreate}
              disabled={creating}
            >
              {creating ? "Creating…" : "New report"}
            </Button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {plans.map((plan) => (
              <Link
                key={plan.id}
                href={`/financial-plans/${plan.id}`}
                className="ui-focus rounded-ui-xl"
              >
                <article className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong">
                  {/* left accent rail — matches the /plans card idiom */}
                  <span
                    className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-brand))]"
                    aria-hidden
                  />
                  {/* hover actions: rename + delete */}
                  <span className="absolute top-2 right-2 sm:top-3.5 sm:right-3.5 flex items-center gap-1">
                    <button
                      onClick={(e) => startRename(plan, e)}
                      className="grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-ui-sm text-content-faint opacity-100 sm:opacity-0 transition-[opacity,color,background] hover:bg-canvas-sunken hover:text-content group-hover:opacity-100"
                      aria-label="Rename report"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => handleDelete(plan.id, plan.title, e)}
                      disabled={deletingId === plan.id}
                      className="grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-ui-sm text-content-faint opacity-100 sm:opacity-0 transition-[opacity,color,background] hover:bg-negative-soft hover:text-negative group-hover:opacity-100 disabled:opacity-50"
                      aria-label="Delete report"
                    >
                      {deletingId === plan.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </span>

                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-ui-md bg-brand-soft text-brand">
                    <FileText className="h-[22px] w-[22px]" />
                  </span>

                  {renamingId === plan.id ? (
                    <span
                      className="mt-4 flex items-center gap-2"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <input
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                        maxLength={255}
                        disabled={savingRename}
                        className="min-w-0 flex-1 rounded-ui-sm border border-line-strong bg-canvas px-2 py-1 font-editorial text-[17px] font-bold text-content focus:outline-none focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]"
                        aria-label="Report name"
                      />
                      <button
                        onClick={commitRename}
                        disabled={savingRename || !renameDraft.trim()}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-[rgb(var(--ui-brand-ink))] disabled:opacity-50"
                        aria-label="Save name"
                      >
                        {savingRename ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                      </button>
                    </span>
                  ) : (
                    <h3 className="mt-4 font-editorial text-[19px] font-bold leading-[1.25] tracking-[-0.015em] text-content line-clamp-2">
                      {plan.title}
                    </h3>
                  )}

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
        </>
      )}

      {/* Name-only creation — reports are always Financial Insights. */}
      <Modal
        open={nameOpen}
        onClose={() => {
          if (!creating) setNameOpen(false);
        }}
        title="New report"
        description="A Financial Insights report written from your live accounts. Takes about ten minutes. Browse the app meanwhile and we'll notify you."
        footer={
          <Button onClick={create} disabled={creating || !nameDraft.trim()}>
            {creating ? "Starting…" : "Create report"}
          </Button>
        }
      >
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
          autoFocus
          maxLength={255}
          disabled={creating}
          className="w-full rounded-ui-md border border-line bg-canvas px-3 py-2.5 text-[15px] font-semibold text-content focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]"
          aria-label="Report name"
        />
        {createError && (
          <p className="mt-2 text-[13px] font-semibold text-negative">{createError}</p>
        )}
      </Modal>
    </div>
  );
}

export function FinancialPlansPage() {
  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
          Financial Reports
        </h1>
        <p className="mt-2 max-w-[52ch] text-[14.5px] font-semibold text-content-muted">
          Financial Insights reports written from your real accounts.
        </p>
      </header>
      <div className="mt-8">
        <FinancialPlansList />
      </div>
    </div>
  );
}
