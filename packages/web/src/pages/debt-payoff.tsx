import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function DebtPayoff() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Debt Payoff</h1>
        <p className="text-text-muted mt-2">Your debt elimination strategy</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-8">
        <StatCard label="Total Debt" value="$107k" status="danger" delay={0} />
        <StatCard label="Monthly Payment" value="$2,100" delay={0.05} />
        <StatCard label="Debt-Free Date" value="Aug 2029" status="success" delay={0.1} />
      </div>

      <Section title="Your Debts">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          Debt list and payoff strategy coming soon...
        </div>
      </Section>
    </div>
  );
}
