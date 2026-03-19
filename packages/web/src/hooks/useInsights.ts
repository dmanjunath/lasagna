import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface Insight {
  id: string;
  category: string;
  urgency: string;
  type: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string | null;
  generatedBy: string;
  createdAt: string;
}

/**
 * Fetches all insights and optionally filters by type.
 * Pass undefined or an empty array to get all insights (no filtering).
 */
export function useInsights(typeFilter?: string | string[]) {
  const [allInsights, setAllInsights] = useState<Insight[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getInsights();
      setAllInsights(data.insights);
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

  return { insights: filtered, isLoading, dismiss, reload, refresh };
}
