import { motion } from 'framer-motion';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function CashFlow() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl font-medium">Cash Flow</h1>
        <p className="text-text-muted mt-2">Income, expenses, and savings analysis</p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-8">
        <StatCard label="Monthly Income" value="$12,500" delay={0} />
        <StatCard label="Monthly Expenses" value="$8,200" delay={0.05} />
        <StatCard label="Savings Rate" value="34%" status="success" delay={0.1} />
        <StatCard label="Emergency Runway" value="18 months" delay={0.15} />
      </div>

      <Section title="Expense Breakdown">
        <div className="glass-card rounded-2xl p-6 text-center text-text-muted">
          Expense visualization coming soon...
        </div>
      </Section>
    </div>
  );
}
