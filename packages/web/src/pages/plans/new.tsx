import { useState } from "react";
import { useLocation } from "wouter";
import { Target, TrendingUp, Sparkles, CreditCard } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
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
  const [selectedType, setSelectedType] = useState<PlanType | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!selectedType || !title.trim()) return;

    setCreating(true);
    try {
      const { plan } = await api.createPlan(selectedType, title);
      setLocation(`/plans/${plan.id}`);
    } catch (error) {
      console.error("Failed to create plan:", error);
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-display font-semibold text-text mb-2">
        Create a Plan
      </h1>
      <p className="text-text-muted mb-8">
        Choose a plan type and give it a name to get started.
      </p>

      <div className="space-y-4 mb-8">
        {planTypes.map((pt, i) => (
          <motion.button
            key={pt.type}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => setSelectedType(pt.type)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              selectedType === pt.type
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-bg-elevated">
                <pt.icon className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-medium text-text">{pt.label}</h3>
                <p className="text-sm text-text-muted mt-1">{pt.description}</p>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {selectedType && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Plan Name
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., My Retirement Plan"
              className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          <Button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full"
          >
            {creating ? "Creating..." : "Create Plan"}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
