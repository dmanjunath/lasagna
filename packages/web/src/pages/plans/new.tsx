import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Target,
  TrendingUp,
  Sparkles,
  CreditCard,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import type { PlanType } from "../../lib/types.js";

// ---------------------------------------------------------------------------
// Plan types — icon + a distinct accent (viz tokens adapt to light/dark) and a
// short "what you get" line so the choice feels considered, not generic.
// ---------------------------------------------------------------------------

const PLAN_TYPES: {
  type: PlanType;
  label: string;
  description: string;
  bullet: string;
  icon: typeof Target;
  accent: string;
  // Darker, AA-safe text shade for the bullet tag (bright viz colors fail as text).
  ink: string;
}[] = [
  {
    type: "retirement",
    label: "Retirement",
    description: "Plan your retirement with withdrawal strategies and projections.",
    bullet: "Monte Carlo · withdrawal rates · scenarios",
    icon: Target,
    accent: "var(--ui-viz-1)",
    ink: "rgb(var(--ui-positive))",
  },
  {
    type: "net_worth",
    label: "Net Worth",
    description: "Track your wealth, analyze trends, and optimize asset allocation.",
    bullet: "All accounts · trends · allocation",
    icon: TrendingUp,
    accent: "var(--ui-viz-2)",
    ink: "rgb(var(--ui-accent-ink))",
  },
  {
    type: "debt_payoff",
    label: "Debt Payoff",
    description: "Create a strategy to pay off debt efficiently.",
    bullet: "Avalanche · snowball · payoff timeline",
    icon: CreditCard,
    accent: "var(--ui-viz-4)",
    ink: "rgb(var(--ui-negative))",
  },
  {
    type: "custom",
    label: "Custom",
    description: "Create a custom plan with AI assistance for any financial goal.",
    bullet: "House fund · college · anything",
    icon: Sparkles,
    accent: "var(--ui-accent)",
    ink: "rgb(var(--ui-accent-ink))",
  },
];

export function NewPlanPage() {
  const [, setLocation] = useLocation();
  const [creatingType, setCreatingType] = useState<PlanType | null>(null);

  const handleSelectType = async (type: PlanType) => {
    setCreatingType(type);
    try {
      const { plan } = await api.createPlan(type);
      setLocation(`/plans/${plan.id}`);
    } catch (error) {
      console.error("Failed to create plan:", error);
      setCreatingType(null);
    }
  };

  const isDemo = import.meta.env.VITE_DEMO_MODE === "true";

  return (
    <div className="mx-auto max-w-[880px] px-3 sm:px-11 pt-3 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="animate-fade-in">
        <Link
          href="/plans"
          className="-ml-2 hidden min-h-touch w-fit items-center gap-1.5 rounded-ui-sm px-2 text-[13px] font-bold text-content-muted transition-colors hover:text-content sm:inline-flex"
        >
          <ArrowLeft className="h-4 w-4" />
          Plans
        </Link>
        <div className="mt-4 mb-3 flex items-center gap-2.5">
          <span
            className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
            style={{ boxShadow: "0 0 0 4px var(--ui-accent-soft)" }}
            aria-hidden
          />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
            New plan
          </span>
        </div>
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
          What are you planning for?
        </h1>
        <p className="mt-2 max-w-[54ch] text-[14.5px] font-semibold text-content-muted">
          Choose a type and Lasagna drafts a plan from your real accounts. You can refine
          everything afterward in chat.
        </p>
      </header>

      {/* ════════ Type chooser ════════ */}
      {isDemo ? (
        <p className="mt-8 text-[14px] font-semibold text-content-muted">
          Plan creation is disabled in demo mode.
        </p>
      ) : (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {PLAN_TYPES.map((pt, i) => {
            const Icon = pt.icon;
            const busy = creatingType === pt.type;
            return (
              <motion.button
                key={pt.type}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => handleSelectType(pt.type)}
                disabled={creatingType !== null}
                className="group relative flex flex-col overflow-hidden rounded-ui-xl border border-line bg-panel p-6 text-left shadow-ui-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <span
                  className="absolute inset-y-0 left-0 w-1"
                  style={{ background: pt.accent }}
                  aria-hidden
                />
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-ui-md"
                    style={{
                      background: `color-mix(in srgb, ${pt.accent} 15%, transparent)`,
                      color: pt.accent,
                    }}
                  >
                    {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Icon className="h-6 w-6" />}
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-content-faint transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-[rgb(var(--ui-brand-ink))]" />
                </div>

                <h3 className="mt-4 font-editorial text-[19px] font-bold tracking-[-0.015em] text-content">
                  {pt.label}
                </h3>
                <p className="mt-1.5 text-[14px] font-semibold leading-[1.5] text-content-muted">
                  {pt.description}
                </p>
                <p
                  className="mt-4 text-[11.5px] font-bold uppercase tracking-[0.06em]"
                  style={{ color: pt.ink }}
                >
                  {busy ? "Creating…" : pt.bullet}
                </p>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
