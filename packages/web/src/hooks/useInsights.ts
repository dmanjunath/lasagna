import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { ApiActionRow } from '../lib/action-rows';

/**
 * One action, exactly as the wire serves it.
 *
 * Both producers write to this shape: the insights engine, whose rows carry
 * advice in words, and the spend-cuts detector, whose rows carry a figure, a
 * receipt and the transactions behind it. `lib/action-rows.ts` normalises them
 * into the one model the row component reads.
 */
export type Insight = ApiActionRow;

/**
 * Fetches all insights and optionally filters by type.
 * Pass undefined or an empty array to get all insights (no filtering).
 */
export function useInsights(typeFilter?: string | string[]) {
  const [allInsights, setAllInsights] = useState<Insight[]>([]);
  const [lastActionsGeneratedAt, setLastActionsGeneratedAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getInsights();
      setAllInsights(data.insights);
      setLastActionsGeneratedAt(
        data.lastActionsGeneratedAt ? new Date(data.lastActionsGeneratedAt) : null
      );
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = useCallback(async (id: string) => {
    await api.dismissInsight(id);
    setAllInsights((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /** Mark an action done. Same removal as dismiss, different verb server-side. */
  const complete = useCallback(async (id: string) => {
    await api.actOnInsight(id);
    setAllInsights((prev) => prev.filter((i) => i.id !== id));
  }, []);

  /** Re-fetch insights from the server without regenerating */
  const reload = useCallback(async () => {
    await load();
  }, [load]);

  /** Regenerate insights server-side, then re-fetch */
  const refresh = useCallback(async () => {
    await api.generateInsights();
    await load();
  }, [load]);

  // Undefined or empty array = no filter (return all)
  const types = Array.isArray(typeFilter)
    ? typeFilter
    : typeFilter
    ? [typeFilter]
    : [];

  const filtered =
    types.length === 0
      ? allInsights
      : allInsights.filter((i) => types.includes(i.type ?? 'general'));

  return { insights: filtered, lastActionsGeneratedAt, isLoading, dismiss, complete, reload, refresh };
}
