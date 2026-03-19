import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronRight, ChevronDown } from 'lucide-react';
import { useLocation } from 'wouter';

export interface SetupStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  action: string | (() => void);
}

interface SetupProgressProps {
  steps: SetupStep[];
}

export function SetupProgress({ steps }: SetupProgressProps) {
  const [, navigate] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const allDone = completedCount === totalCount;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  // Show up to 3 incomplete steps when collapsed, all when expanded
  const incompleteSteps = steps.filter((s) => !s.completed);
  const completedSteps = steps.filter((s) => s.completed);
  const visibleIncomplete = expanded ? incompleteSteps : incompleteSteps.slice(0, 3);
  const hiddenCount = incompleteSteps.length - visibleIncomplete.length;

  useEffect(() => {
    if (allDone) {
      const timer = setTimeout(() => setDismissed(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [allDone]);

  function handleStepClick(step: SetupStep) {
    if (step.completed) return;
    if (typeof step.action === 'string') {
      navigate(step.action);
    } else {
      step.action();
    }
  }

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card px-4 py-3 mb-5"
        >
          {/* Header + progress bar inline */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider whitespace-nowrap">
              {allDone ? 'Complete ✓' : 'Get Started'}
            </span>
            <div className="flex-1 h-1 rounded-full bg-surface">
              <motion.div
                className="h-full rounded-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <span className="text-xs text-text-secondary tabular-nums whitespace-nowrap">
              {completedCount}/{totalCount}
            </span>
          </div>

          {/* Compact step rows — incomplete first */}
          <div className="space-y-px">
            {visibleIncomplete.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => handleStepClick(step)}
                className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover transition-colors"
              >
                <div className="w-4 h-4 rounded-full border-[1.5px] border-text-muted/40 shrink-0" />
                <span className="flex-1 text-[13px] font-medium text-text truncate">{step.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-text-secondary shrink-0" />
              </button>
            ))}

            {/* Show more / less toggle */}
            {incompleteSteps.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs text-text-secondary hover:text-text-secondary transition-colors"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                <span>{expanded ? 'Show less' : `${hiddenCount} more`}</span>
              </button>
            )}

            {/* Completed steps — collapsed summary */}
            {completedCount > 0 && (
              <div className="flex items-center gap-2 px-2 py-1">
                <Check className="w-3.5 h-3.5 text-success shrink-0" />
                <span className="text-xs text-text-secondary">
                  {completedCount} completed
                </span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
