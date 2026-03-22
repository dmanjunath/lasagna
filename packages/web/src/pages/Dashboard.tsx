import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';
import { StatCard } from '../components/common/stat-card';
import { Section } from '../components/common/section';
import { Button } from '../components/ui/button';

interface Todo {
  id: number;
  text: string;
  plan: string;
  planPath: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
}

// Mock data - will come from API
const mockTodos: Todo[] = [
  { id: 1, text: 'Review Roth conversion opportunity', plan: 'Tax Strategy', planPath: '/tax-strategy', priority: 'high', dueDate: 'Apr 15' },
  { id: 2, text: 'Increase 401k contribution', plan: 'Retirement', planPath: '/plans/retirement', priority: 'high', dueDate: 'Next paycheck' },
  { id: 3, text: 'Pay extra $200 on credit card', plan: 'Debt Payoff', planPath: '/plans/debt-payoff', priority: 'medium', dueDate: 'Mar 28' },
  { id: 4, text: 'Update tax withholdings', plan: 'Tax Strategy', planPath: '/tax-strategy', priority: 'low', dueDate: 'Apr 1' },
];

const mockSummaries = [
  { id: 'net-worth', icon: '◈', name: 'Net Worth', value: '+2.4%', label: 'this month', status: 'success' as const, path: '/net-worth' },
  { id: 'retirement', icon: '◎', name: 'Retirement', value: '73%', label: 'readiness', status: 'warning' as const, path: '/plans/retirement' },
  { id: 'tax-strategy', icon: '◇', name: 'Tax Strategy', value: '$12.1k', label: 'savings found', status: 'success' as const, path: '/tax-strategy' },
  { id: 'debt-payoff', icon: '◆', name: 'Debt Payoff', value: 'Aug 2029', label: 'debt-free date', status: 'success' as const, path: '/plans/debt-payoff' },
  { id: 'cash-flow', icon: '◉', name: 'Cash Flow', value: '34%', label: 'savings rate', status: 'success' as const, path: '/cash-flow' },
];

export function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [completedTodos, setCompletedTodos] = useState<number[]>([]);

  const toggleTodo = (id: number) => {
    setCompletedTodos((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const priorityColors = {
    high: 'bg-danger',
    medium: 'bg-warning',
    low: 'bg-accent',
  };

  const firstName = user?.email?.split('@')[0] || 'there';

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-10"
      >
        <p className="text-text-muted text-sm mb-1">Good morning,</p>
        <h2 className="font-display text-3xl md:text-4xl font-medium tracking-tight capitalize">
          {firstName}
        </h2>
      </motion.div>

      {/* Plan Summaries */}
      <Section title="Your Financial Plans">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
          {mockSummaries.map((summary, i) => (
            <StatCard
              key={summary.id}
              icon={summary.icon}
              label={summary.name}
              value={summary.value}
              status={summary.status}
              onClick={() => navigate(summary.path)}
              delay={i * 0.05}
            />
          ))}
        </div>
      </Section>

      {/* Action Items */}
      <Section title="Action Items">
        <div className="glass-card rounded-2xl divide-y divide-border overflow-hidden">
          {mockTodos.map((todo, i) => (
            <motion.div
              key={todo.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className={cn(
                'p-4 md:p-5 flex items-center gap-3 md:gap-4 transition-all duration-300 hover:bg-surface-hover',
                completedTodos.includes(todo.id) && 'opacity-40'
              )}
            >
              <button
                onClick={() => toggleTodo(todo.id)}
                className={cn(
                  'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0',
                  completedTodos.includes(todo.id)
                    ? 'bg-accent border-accent text-bg'
                    : 'border-border hover:border-accent/50'
                )}
              >
                {completedTodos.includes(todo.id) && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', priorityColors[todo.priority])} />

              <div className="flex-1 min-w-0">
                <div className={cn('text-sm font-medium', completedTodos.includes(todo.id) && 'line-through text-text-muted')}>
                  {todo.text}
                </div>
                <button
                  onClick={() => navigate(todo.planPath)}
                  className="text-sm text-text-muted hover:text-accent transition-colors"
                >
                  {todo.plan}
                </button>
              </div>

              <div className="text-sm text-text-muted font-medium flex-shrink-0">{todo.dueDate}</div>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Quick Actions */}
      <Section title="Quick Actions">
        <div className="flex flex-wrap gap-3">
          <Button>Sync All Accounts</Button>
          <Button variant="secondary">Run Full Analysis</Button>
          <Button variant="secondary">Export Reports</Button>
        </div>
      </Section>
    </div>
  );
}
