import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Plus, FileText, Loader2, Trash2, Info } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import type { Plan, PlanType } from "../../lib/types.js";

const planTypes = [
  {
    type: 'retirement' as PlanType,
    icon: '🎯',
    title: 'Retirement',
    description: 'Plan when you can retire and test scenarios',
    tooltip: 'Plan your retirement with Monte Carlo simulations, withdrawal strategies, and scenario analysis'
  },
  {
    type: 'net_worth' as PlanType,
    icon: '📈',
    title: 'Net Worth',
    description: 'Track wealth and optimize allocation',
    tooltip: 'Track your total wealth across all accounts, analyze trends, and optimize asset allocation'
  },
  {
    type: 'debt_payoff' as PlanType,
    icon: '💳',
    title: 'Debt Payoff',
    description: 'Create a debt payoff strategy',
    tooltip: 'Create a strategy to pay off debt using avalanche or snowball methods, see payoff timelines'
  },
  {
    type: 'custom' as PlanType,
    icon: '✨',
    title: 'Custom',
    description: 'Any financial goal with AI assistance',
    tooltip: 'Create a custom plan for any financial goal - saving for a house, college fund, vacation, etc.'
  }
];

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

  const planTypeLabels = {
    net_worth: "Net Worth",
    retirement: "Retirement",
    debt_payoff: "Debt Payoff",
    custom: "Custom",
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl lg:text-4xl font-display font-semibold text-text">
            Financial Plans
          </h1>
          <p className="text-text-muted mt-1">
            AI-powered plans tailored to your goals
          </p>
        </div>
        <Link href="/plans/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Plan
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading plans...</span>
          </div>
        </div>
      ) : plans.length === 0 ? (
        <div className="glass-card text-center py-12 px-6">
          <h2 className="text-2xl font-display font-semibold text-text mb-2">
            Create Your First Plan
          </h2>
          <p className="text-text-muted mb-8 max-w-2xl mx-auto">
            Choose a plan type to get started with AI-powered financial guidance
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {planTypes.map((planType, i) => (
              <motion.button
                key={planType.type}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => handleCreatePlan(planType.type)}
                disabled={creatingPlanType !== null}
                className="relative p-6 rounded-xl border border-border bg-surface hover:border-accent/50 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-start gap-4">
                  <div className="text-3xl flex-shrink-0">
                    {creatingPlanType === planType.type ? (
                      <Loader2 className="w-8 h-8 text-accent animate-spin" />
                    ) : (
                      planType.icon
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium text-text">{planType.title}</h3>
                      <div className="group/tooltip relative">
                        <Info className="w-4 h-4 text-text-muted hover:text-text cursor-help" />
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 p-3 rounded-lg bg-bg-elevated border border-border shadow-lg text-sm text-text-muted opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all pointer-events-none z-10">
                          {planType.tooltip}
                          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-border"></div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-text-muted">
                      {planType.description}
                    </p>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan, i) => (
            <Link key={plan.id} href={`/plans/${plan.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card glass-card-hover p-6 cursor-pointer relative group"
              >
                <button
                  onClick={(e) => handleDeletePlan(plan.id, plan.title, e)}
                  disabled={deletingPlanId === plan.id}
                  className="absolute top-4 right-4 p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Delete plan"
                >
                  {deletingPlanId === plan.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent">
                    {planTypeLabels[plan.type]}
                  </span>
                  <span className="text-xs text-text-muted capitalize">
                    {plan.status}
                  </span>
                </div>
                <h3 className="font-medium text-text mb-2">{plan.title}</h3>
                <p className="text-sm text-text-muted">
                  Updated {new Date(plan.updatedAt).toLocaleDateString()}
                </p>
              </motion.div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
