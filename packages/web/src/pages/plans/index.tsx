import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus, FileText, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import type { Plan } from "../../lib/types.js";

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPlans().then(({ plans }) => {
      setPlans(plans);
      setLoading(false);
    });
  }, []);

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
        <div className="glass-card text-center py-12">
          <FileText className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text mb-2">No plans yet</h3>
          <p className="text-text-muted mb-4">
            Create your first financial plan to get started.
          </p>
          <Link href="/plans/new">
            <Button>Create Plan</Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan, i) => (
            <Link key={plan.id} href={`/plans/${plan.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card glass-card-hover p-6 cursor-pointer"
              >
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
