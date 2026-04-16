import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface MetricTileProps {
  label: string;
  value: string;
  subtitle: string;
  status?: 'default' | 'success' | 'warning' | 'danger';
  delay?: number;
}

const statusColors = {
  default: '',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function MetricTile({ label, value, subtitle, status = 'default', delay = 0 }: MetricTileProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="bg-bg-elevated border border-border rounded-xl p-4"
    >
      <p className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-1.5">
        {label}
      </p>
      <p className={cn('text-xl font-bold tabular-nums leading-none', statusColors[status])}>
        {value}
      </p>
      <p className="text-xs text-text-secondary mt-1">
        {subtitle}
      </p>
    </motion.div>
  );
}
