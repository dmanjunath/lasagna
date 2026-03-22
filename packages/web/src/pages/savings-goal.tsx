import { useRoute } from 'wouter';
import { motion } from 'framer-motion';
import { Progress } from '../components/ui/progress';

export function SavingsGoal() {
  const [, params] = useRoute('/plans/savings/:id');
  const goalId = params?.id || 'unknown';

  // Mock data based on ID
  const goals: Record<string, { name: string; target: number; current: number; targetDate: string }> = {
    house: { name: 'House Down Payment', target: 80000, current: 36000, targetDate: 'Dec 2027' },
    vacation: { name: 'Europe Vacation', target: 8000, current: 5760, targetDate: 'Aug 2026' },
  };

  const goal = goals[goalId] || { name: 'Unknown Goal', target: 10000, current: 0, targetDate: 'TBD' };
  const progress = (goal.current / goal.target) * 100;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">{goal.name}</h1>
        <p className="text-text-muted mt-2">Target: {goal.targetDate}</p>
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
              ${goal.current.toLocaleString()}
              <span className="text-xl md:text-2xl text-text-muted"> / ${goal.target.toLocaleString()}</span>
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
