// A savings goal's pace verdict, the native app's goalStatus (packages/mobile
// src/lib/goals.ts): with a monthly plan and a deadline still ahead, on track
// when the plan lands by the deadline, slipping up to three months late, off
// track beyond. Nothing to judge (no plan, no deadline, reached, not started,
// not active) is no status.

export type GoalVerdict = 'good' | 'attention' | 'bad';

type GoalLike = {
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string | null;
  deadline: string | null;
  status: string;
};

/** How far behind still reads as slipping rather than off track. */
export const SLIPPING_MONTHS = 3;

export function goalStatus(g: GoalLike, now: Date = new Date()): GoalVerdict | null {
  const target = parseFloat(g.targetAmount) || 0;
  const current = parseFloat(g.currentAmount) || 0;
  const remaining = Math.max(0, target - current);
  if (g.status !== 'active' || target <= 0 || current >= target || current <= 0 || remaining <= 0) return null;
  const plan = g.monthlyContribution ? parseFloat(g.monthlyContribution) : 0;
  if (!(plan > 0) || !g.deadline) return null;
  const deadline = new Date(g.deadline);
  if (deadline.getTime() - now.getTime() <= 0) return null;
  const months = Math.ceil(remaining / plan);
  if (months > 1200) return 'bad';
  const eta = new Date(now);
  eta.setMonth(eta.getMonth() + months);
  const late = eta.getTime() <= deadline.getTime()
    ? 0
    : Math.max(1, (eta.getFullYear() - deadline.getFullYear()) * 12 + eta.getMonth() - deadline.getMonth());
  if (late > SLIPPING_MONTHS) return 'bad';
  return late > 0 ? 'attention' : 'good';
}

/** The verdict's fill (basil, the one yellow, sauce), or a neutral fill with no verdict. */
export function goalStatusFill(v: GoalVerdict | null): string {
  if (v === 'good') return 'rgb(var(--ui-brand))';
  if (v === 'attention') return 'var(--ui-celebration)';
  if (v === 'bad') return 'rgb(var(--ui-negative))';
  return 'rgb(var(--ui-content-faint))';
}
