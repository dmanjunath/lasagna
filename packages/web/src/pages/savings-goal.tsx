import { useState, useEffect } from 'react';
import { useRoute } from 'wouter';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { Progress } from '../components/ui/progress';
import { api } from '../lib/api';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function SavingsGoal() {
  const [, params] = useRoute('/plans/savings/:id');
  const goalId = params?.id || '';

  const [goal, setGoal] = useState<{
    name: string;
    target: number;
    current: number;
    deadline: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.getGoals()
      .then(({ goals }) => {
        const found = goals.find((g) => g.id === goalId);
        if (found) {
          setGoal({
            name: found.name,
            target: parseFloat(found.targetAmount),
            current: parseFloat(found.currentAmount),
            deadline: found.deadline,
          });
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [goalId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (notFound || !goal) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        Goal not found
      </div>
    );
  }

  const progress = goal.target > 0 ? (goal.current / goal.target) * 100 : 0;
  const deadlineLabel = goal.deadline
    ? new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">{goal.name}</h1>
        {deadlineLabel && (
          <p className="text-text-muted mt-2">Target: {deadlineLabel}</p>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6 md:p-8 mb-8"
      >
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="text-text-muted text-sm mb-2">Current Progress</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tabular-nums">
              {formatCurrency(goal.current)}
              <span className="text-xl md:text-2xl text-text-muted"> / {formatCurrency(goal.target)}</span>
            </div>
          </div>
          <div className="text-lg md:text-xl font-semibold text-success">
            {progress.toFixed(0)}% complete
          </div>
        </div>
        <Progress value={progress} glow className="h-3" />
      </motion.div>
    </div>
  );
}
