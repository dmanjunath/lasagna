import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Plus,
  Loader2,
  Trash2,
  Info,
  Target,
  TrendingUp,
  CreditCard,
  Sparkles,
  ArrowRight,
  ChevronRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button, Skeleton } from "../../components/uikit";
import type { Plan, PlanType } from "../../lib/types.js";

// ---------------------------------------------------------------------------
// Plan-type visual language — icon + a distinct accent per type so plans stay
// glanceable. Accents are viz tokens so light/dark adapt automatically.
// ---------------------------------------------------------------------------

type PlanMeta = {
  label: string;
  icon: typeof Target;
  accent: string;
  // Darker, AA-safe text shade for the type pill (bright viz colors fail as text).
  ink: string;
  description: string;
  tooltip: string;
};

const PLAN_META: Record<PlanType, PlanMeta> = {
  retirement: {
    label: "Retirement",
    icon: Target,
    accent: "var(--ui-viz-1)",
    ink: "rgb(var(--ui-positive))",
    description: "Plan when you can retire and test scenarios",
    tooltip:
      "Plan your retirement with Monte Carlo simulations, withdrawal strategies, and scenario analysis",
  },
  net_worth: {
    label: "Net Worth",
    icon: TrendingUp,
    accent: "var(--ui-viz-2)",
    ink: "rgb(var(--ui-accent-ink))",
    description: "Track wealth and optimize allocation",
    tooltip:
      "Track your total wealth across all accounts, analyze trends, and optimize asset allocation",
  },
  debt_payoff: {
    label: "Debt Payoff",
    icon: CreditCard,
    accent: "var(--ui-viz-4)",
    ink: "rgb(var(--ui-negative))",
    description: "Create a debt payoff strategy",
    tooltip:
      "Create a strategy to pay off debt using avalanche or snowball methods, see payoff timelines",
  },
  custom: {
    label: "Custom",
    icon: Sparkles,
    accent: "var(--ui-accent)",
    ink: "rgb(var(--ui-accent-ink))",
    description: "Any financial goal with AI assistance",
    tooltip:
      "Create a custom plan for any financial goal — saving for a house, college fund, vacation, etc.",
  },
};

const PLAN_ORDER: PlanType[] = ["retirement", "net_worth", "debt_payoff", "custom"];

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [creatingPlanType, setCreatingPlanType] = useState<PlanType | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    api.getPlans().then(({ plans }) => {
      setPlans(plans);
      setLoading(false);
    });
  }, []);

  const handleDeletePlan = async (planId: string, planTitle: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation to plan detail
    e.stopPropagation();

    const confirmed = window.confirm(`Delete '${planTitle}'? This will archive the plan.`);
    if (!confirmed) return;

    setDeletingPlanId(planId);
    try {
      await api.deletePlan(planId);
      setPlans((prevPlans) => prevPlans.filter((plan) => plan.id !== planId));
    } catch (error) {
      console.error("Failed to delete plan:", error);
      alert("Failed to delete plan. Please try again.");
    } finally {
      setDeletingPlanId(null);
    }
  };

  const handleCreatePlan = async (type: PlanType) => {
    setCreatingPlanType(type);
    try {
      const { plan } = await api.createPlan(type);
      setLocation(`/plans/${plan.id}`);
    } catch (error) {
      console.error("Failed to create plan:", error);
      setCreatingPlanType(null);
    }
  };

  const isDemo = import.meta.env.VITE_DEMO_MODE === "true";
  const areasTracked = new Set(plans.map((p) => p.type)).size;

  const summaryLine = !loading && plans.length > 0 && (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span>
        <b className="font-extrabold text-content ui-tnum">{plans.length}</b>{" "}
        plan{plans.length === 1 ? "" : "s"}
      </span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
      <span>
        <b className="font-extrabold text-content ui-tnum">{areasTracked}</b>{" "}
        area{areasTracked === 1 ? "" : "s"} tracked
      </span>
    </span>
  );

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
        <div className="min-w-0">
          <span className="mb-3 inline-flex items-center gap-2.5">
            <span
              className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              AI financial plans
            </span>
          </span>
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Plans
          </h1>
          {summaryLine ? (
            <p className="mt-2 text-[14.5px] font-semibold text-content-muted">{summaryLine}</p>
          ) : (
            !loading && (
              <p className="mt-2 max-w-[52ch] text-[14.5px] font-semibold text-content-muted">
                Build and follow AI-guided plans for retirement, net worth, debt payoff, and more.
              </p>
            )
          )}
        </div>
        {!isDemo && plans.length > 0 && (
          <Link href="/plans/new">
            <Button leadingIcon={<Plus className="h-4 w-4" />}>New plan</Button>
          </Link>
        )}
      </header>

      {/* ════════ Loading skeleton ════════ */}
      {loading && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
              <div className="flex items-center gap-3">
                <Skeleton className="h-11 w-11 rounded-ui-md" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="mt-5 h-6 w-3/4" />
              <Skeleton className="mt-4 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {/* ════════ Empty state — plan-type chooser ════════ */}
      {!loading && plans.length === 0 && (
        <section className="mt-8">
          <div className="relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-8">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 90% at 100% 0%, var(--ui-accent-softer), transparent 56%)," +
                  "radial-gradient(90% 80% at 0% 10%, var(--ui-brand-softer), transparent 60%)",
              }}
              aria-hidden
            />
            <div className="relative">
              <h2 className="font-editorial text-[22px] sm:text-[26px] font-bold tracking-[-0.02em] text-content">
                Create your first plan
              </h2>
              <p className="mt-2 max-w-[54ch] text-[14.5px] font-semibold text-content-muted">
                Pick a type below and Lasagna drafts a plan from your real accounts — then
                refine it in chat.
              </p>

              {!isDemo && (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {PLAN_ORDER.map((type, i) => (
                    <PlanTypeCard
                      key={type}
                      type={type}
                      index={i}
                      creating={creatingPlanType === type}
                      disabled={creatingPlanType !== null}
                      onClick={() => handleCreatePlan(type)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ════════ Plans grid ════════ */}
      {!loading && plans.length > 0 && (
        <>
          <div className="mt-9 flex items-center gap-2.5">
            <span
              className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
              aria-hidden
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              Your plans
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {plans.map((plan, i) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                index={i}
                deleting={deletingPlanId === plan.id}
                showDelete={!isDemo}
                onDelete={(e) => handleDeletePlan(plan.id, plan.title, e)}
              />
            ))}
            {!isDemo && <AddPlanTile index={plans.length} />}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan card — a saved plan
// ---------------------------------------------------------------------------

function PlanCard({
  plan,
  index,
  deleting,
  showDelete,
  onDelete,
}: {
  plan: Plan;
  index: number;
  deleting: boolean;
  showDelete: boolean;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const meta = PLAN_META[plan.type];
  const Icon = meta.icon;

  return (
    <Link href={`/plans/${plan.id}`}>
      <motion.article
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 8) * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong"
      >
        {/* left accent rail */}
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.accent }} aria-hidden />

        {showDelete && (
          <button
            onClick={onDelete}
            disabled={deleting}
            className="absolute top-2 right-2 sm:top-3.5 sm:right-3.5 grid h-11 w-11 sm:h-8 sm:w-8 place-items-center rounded-ui-sm text-content-faint opacity-100 sm:opacity-0 transition-[opacity,color,background] hover:bg-negative-soft hover:text-negative group-hover:opacity-100 disabled:opacity-50"
            aria-label="Delete plan"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        )}

        <div className="flex items-center gap-3">
          <span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-ui-md"
            style={{
              background: `color-mix(in srgb, ${meta.accent} 15%, transparent)`,
              color: meta.accent,
            }}
          >
            <Icon className="h-[22px] w-[22px]" />
          </span>
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.06em]"
            style={{
              background: `color-mix(in srgb, ${meta.accent} 12%, transparent)`,
              color: meta.ink,
            }}
          >
            {meta.label}
          </span>
        </div>

        <h3 className="mt-4 font-editorial text-[19px] font-bold leading-[1.25] tracking-[-0.015em] text-content line-clamp-2">
          {plan.title}
        </h3>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-content-muted">
            <span
              className="inline-flex items-center rounded-full bg-canvas-sunken px-2 py-0.5 text-[11px] font-bold capitalize text-content-secondary"
            >
              {plan.status}
            </span>
            <span className="ui-tnum">
              Updated {new Date(plan.updatedAt).toLocaleDateString()}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[13px] font-bold text-content-muted transition-colors group-hover:text-[rgb(var(--ui-brand-ink))]">
            View
            <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </motion.article>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Add-plan tile
// ---------------------------------------------------------------------------

function AddPlanTile({ index }: { index: number }) {
  return (
    <Link href="/plans/new">
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 8) * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        aria-label="Create a new plan"
        className="group flex h-full min-h-[176px] w-full flex-col items-center justify-center gap-1.5 rounded-ui-xl border border-[rgb(var(--ui-accent))]/30 bg-[var(--ui-accent-soft)] p-6 text-center transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md"
      >
        <span className="mb-1 grid h-[50px] w-[50px] place-items-center rounded-ui-lg bg-[rgb(var(--ui-accent))] text-white shadow-ui-sm transition-transform group-hover:scale-105">
          <Plus className="h-6 w-6" />
        </span>
        <span className="font-editorial text-[16px] font-bold tracking-[-0.01em] text-[rgb(var(--ui-accent-ink))]">
          Start another plan
        </span>
        <span className="max-w-[26ch] text-[13px] font-semibold text-content-muted">
          Retirement, net worth, debt payoff, or a custom goal.
        </span>
      </motion.button>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Plan-type chooser card (empty state)
// ---------------------------------------------------------------------------

function PlanTypeCard({
  type,
  index,
  creating,
  disabled,
  onClick,
}: {
  type: PlanType;
  index: number;
  creating: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const meta = PLAN_META[type];
  const Icon = meta.icon;
  // Tap-toggled so the tooltip works on touch; a tap on ⓘ must not create a plan.
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      disabled={disabled}
      className="group relative flex items-start gap-4 rounded-ui-lg border border-line bg-panel p-5 text-left shadow-ui-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent-soft)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
    >
      {/* No overflow-hidden on the card — the ⓘ tooltip must escape it — so the
          accent strip rounds its own left edge to hug the card corners. */}
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-ui-lg" style={{ background: meta.accent }} aria-hidden />
      <span
        className="grid h-12 w-12 shrink-0 place-items-center rounded-ui-md"
        style={{
          background: `color-mix(in srgb, ${meta.accent} 15%, transparent)`,
          color: meta.accent,
        }}
      >
        {creating ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icon className="h-6 w-6" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-editorial text-[17px] font-bold tracking-[-0.015em] text-content">
            {meta.label}
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`About ${meta.label} plans`}
            aria-expanded={tipOpen}
            onClick={(e) => {
              e.stopPropagation();
              setTipOpen((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setTipOpen((v) => !v);
              }
            }}
            onBlur={() => setTipOpen(false)}
            className="group/tip relative inline-flex min-h-[32px] min-w-[32px] items-center justify-center"
          >
            <Info className="h-3.5 w-3.5 cursor-help text-content-faint transition-colors hover:text-content-secondary" />
            <span
              className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-60 -translate-x-1/2 rounded-ui-md border border-line bg-panel-raised p-3 text-[12.5px] font-medium leading-snug text-content-secondary shadow-ui-lg transition-opacity ${tipOpen ? 'opacity-100' : 'opacity-0 group-hover/tip:opacity-100'}`}
            >
              {meta.tooltip}
            </span>
          </span>
        </span>
        <span className="mt-1 block text-[13.5px] font-semibold text-content-muted">
          {meta.description}
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-content-faint transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-[rgb(var(--ui-brand-ink))]" />
    </motion.button>
  );
}
