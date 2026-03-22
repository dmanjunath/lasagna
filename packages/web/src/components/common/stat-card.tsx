import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  icon?: string;
  status?: 'default' | 'success' | 'warning' | 'danger';
  onClick?: () => void;
  delay?: number;
}

export function StatCard({ label, value, icon, status = 'default', onClick, delay = 0 }: StatCardProps) {
  const statusColors = {
    default: '',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  const Wrapper = onClick ? motion.button : motion.div;

  return (
    <Wrapper
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={cn(
        'stat-card glass-card rounded-2xl p-5 text-left',
        onClick && 'glass-card-hover cursor-pointer'
      )}
    >
      {icon && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg text-text-muted">{icon}</span>
          <span className="text-sm text-text-secondary font-medium">{label}</span>
        </div>
      )}
      {!icon && <p className="text-text-secondary text-sm mb-2">{label}</p>}
      <div className={cn('font-display text-2xl font-semibold tabular-nums', statusColors[status])}>
        {value}
      </div>
    </Wrapper>
  );
}
