import { motion } from 'framer-motion';
import { FileUp } from 'lucide-react';
import { Section } from '../components/common/section';
import { StatCard } from '../components/common/stat-card';

export function TaxStrategy() {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">Tax Strategy</h1>
        <p className="text-text-muted mt-2">Tax optimization opportunities</p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-8">
        <StatCard label="Marginal Bracket" value="24%" delay={0} />
        <StatCard label="Effective Rate" value="18.2%" delay={0.05} />
        <StatCard label="Potential Savings" value="$12,100" status="success" delay={0.1} />
      </div>

      <Section title="Tax Return Analysis">
        <div className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center">
          <FileUp className="w-12 h-12 text-text-muted mb-4" />
          <p className="text-text-muted">PDF upload and analysis coming soon...</p>
        </div>
      </Section>
    </div>
  );
}
