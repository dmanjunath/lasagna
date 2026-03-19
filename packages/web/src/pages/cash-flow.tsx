import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function CashFlow() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">Cash Flow</h1>
        <p className="text-text-secondary mt-2">Income, expenses, and savings analysis</p>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 mb-8">
        <StatCard label="Monthly Income" value="$12,500" delay={0} />
        <StatCard label="Monthly Expenses" value="$8,200" delay={0.05} />
        <StatCard label="Savings Rate" value="34%" status="success" delay={0.1} />
        <StatCard label="Emergency Runway" value="18 months" delay={0.15} />
      </div>

      <Section title="Expense Breakdown">
        <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
          <BarChart3 className="w-12 h-12 text-text-secondary mb-4" />
          <p className="text-text-secondary">Expense visualization coming soon...</p>
        </div>
      </Section>
    </div>
  );
}
