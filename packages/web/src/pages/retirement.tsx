import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { Progress } from '../components/ui/progress';

export function Retirement() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Retirement Plan</h1>
        <p className="text-text-muted mt-2">Track your retirement readiness</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6 md:p-8 mb-8"
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-text-muted text-sm mb-2">Retirement Readiness</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-5xl md:text-6xl font-semibold text-accent tabular-nums">73</span>
              <span className="font-display text-xl md:text-2xl text-text-muted">%</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl md:text-3xl font-semibold tabular-nums">$1.2M</div>
            <div className="text-sm text-text-muted mt-1">Projected at 65</div>
          </div>
        </div>
        <Progress value={73} glow />
      </motion.div>

      <Section title="AI Recommendations">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          AI-powered recommendations coming soon...
        </div>
      </Section>
    </div>
  );
}
