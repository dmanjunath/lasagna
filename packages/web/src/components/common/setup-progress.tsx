import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
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

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;
  const allDone = completedCount === totalCount;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  // Auto-hide after 2 seconds when all complete
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
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="glass-card p-5 mb-6"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold">
              {allDone ? 'Setup Complete \u2713' : 'Get Started'}
            </h3>
            <span className="text-xs text-text-muted font-medium tabular-nums">
              {completedCount} of {totalCount}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 rounded-full bg-surface mb-5">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              style={{
                boxShadow: '0 0 8px rgba(52, 199, 89, 0.4)',
              }}
            />
          </div>

          {/* Steps list */}
          <div className="space-y-0.5">
            {steps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => handleStepClick(step)}
                disabled={step.completed}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  step.completed
                    ? 'cursor-default'
                    : 'hover:bg-surface-hover cursor-pointer'
                }`}
              >
                {step.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-text-muted shrink-0" />
                )}

                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium leading-tight ${
                      step.completed ? 'opacity-60' : 'text-text'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p
                    className={`text-xs mt-0.5 leading-tight ${
                      step.completed ? 'text-text-muted opacity-60' : 'text-text-muted'
                    }`}
                  >
                    {step.description}
                  </p>
                </div>

                {!step.completed && (
                  <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
                )}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
