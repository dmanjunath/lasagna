/**
 * At most one "you spent more than usual" action on the list.
 *
 * Both producers can write one: the spend-cuts scan's "category above trend"
 * finding, and an engine action the model flagged `overspend`. Each producer
 * already keeps itself to one, so this is the rule across the two. The one
 * kept is the largest monthly figure, then the most urgent, then the newest.
 */
export interface OverspendCandidate {
  producer: string;
  metadata: unknown;
  monthlyValue: string | number | null;
  urgency: string;
  createdAt: Date | string;
}

const URGENCY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function isOverspend(r: OverspendCandidate): boolean {
  const meta = (r.metadata ?? {}) as { kind?: string; overspend?: boolean };
  return meta.kind === "category_above_trend" || meta.overspend === true;
}

export function capOverspend<T extends OverspendCandidate>(rows: T[]): T[] {
  const over = rows.filter(isOverspend);
  if (over.length <= 1) return rows;
  const score = (r: T) => [
    Number(r.monthlyValue ?? 0),
    URGENCY_RANK[r.urgency] ?? 1,
    new Date(r.createdAt).getTime(),
  ];
  const keep = over.reduce((best, r) => {
    const [a, b] = [score(r), score(best)];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? r : best;
    return best;
  });
  return rows.filter((r) => !isOverspend(r) || r === keep);
}
