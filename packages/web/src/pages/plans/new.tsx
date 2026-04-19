import { useState } from "react";
import { useLocation } from "wouter";
import { Target, TrendingUp, Sparkles, CreditCard, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import type { PlanType } from "../../lib/types.js";

const planTypes: { type: PlanType; label: string; description: string; icon: typeof Target }[] = [
  {
    type: "net_worth",
    label: "Net Worth",
    description: "Track your wealth, analyze trends, and optimize asset allocation",
    icon: TrendingUp,
  },
  {
    type: "retirement",
    label: "Retirement",
    description: "Plan your retirement with withdrawal strategies and projections",
    icon: Target,
  },
  {
    type: "debt_payoff",
    label: "Debt Payoff",
    description: "Create a strategy to pay off debt efficiently",
    icon: CreditCard,
  },
  {
    type: "custom",
    label: "Custom",
    description: "Create a custom plan with AI assistance for any financial goal",
    icon: Sparkles,
  },
];

export function NewPlanPage() {
  const [, setLocation] = useLocation();
  const [creating, setCreating] = useState(false);

  const handleSelectType = async (type: PlanType) => {
    setCreating(true);
    try {
      const { plan } = await api.createPlan(type);
      setLocation(`/plans/${plan.id}`);
    } catch (error) {
      console.error("Failed to create plan:", error);
      setCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold text-text mb-2">
        Create a Plan
      </h1>
      <p className="text-text-secondary mb-8">
        Choose a plan type to get started.
      </p>

      {import.meta.env.VITE_DEMO_MODE !== "true" ? (
        <div className="space-y-4">
          {planTypes.map((pt, i) => (
            <motion.button
              key={pt.type}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => handleSelectType(pt.type)}
              disabled={creating}
              className={cn(
                "w-full p-4 rounded-xl border text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                creating
                  ? "opacity-50 cursor-not-allowed"
                  : "border-border bg-surface hover:border-accent/50"
              )}
            >
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-bg-elevated">
                  {creating ? (
                    <Loader2 className="w-5 h-5 text-accent animate-spin" />
                  ) : (
                    <pt.icon className="w-5 h-5 text-accent" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-text">{pt.label}</h3>
                  <p className="text-sm text-text-secondary mt-1">{pt.description}</p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>
      ) : (
        <p className="text-text-secondary text-sm">Plan creation is disabled in demo mode.</p>
      )}
    </div>
  );
}
