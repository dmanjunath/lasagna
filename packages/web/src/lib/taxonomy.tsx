import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Receipt } from 'lucide-react';
import { api, type TaxonomyCategory, type TaxonomyGroup } from './api';
import { getCategoryDisplay } from './categories';

// ---------------------------------------------------------------------------
// TaxonomyProvider — fetches the tenant's category taxonomy once and shares it
// app-wide. Pickers build options from `groups`; row display resolves by id
// (byId) with a generic fallback. `refresh()` re-fetches after any management
// mutation.
// ---------------------------------------------------------------------------

export type TaxonomyEntry = TaxonomyCategory & { group: TaxonomyGroup };

interface TaxonomyContextValue {
  groups: TaxonomyGroup[];
  loading: boolean;
  error: string | null;
  byId: Map<string, TaxonomyEntry>;
  bySystemKey: Map<string, TaxonomyEntry>;
  refresh: () => Promise<void>;
}

const TaxonomyContext = createContext<TaxonomyContextValue | null>(null);

export function TaxonomyProvider({ children }: { children: React.ReactNode }) {
  const [groups, setGroups] = useState<TaxonomyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Latest-wins: a slow first fetch can't clobber a refresh() that resolved later.
  const seqRef = useRef(0);
  // Only used for the single auto-retry on initial failure.
  const hasSucceededRef = useRef(false);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await api.getCategoryTaxonomy();
      if (seq === seqRef.current) {
        setGroups(data.groups);
        setError(null);
        hasSucceededRef.current = true;
      }
    } catch (e) {
      if (seq === seqRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to load categories');
        // One automatic retry after 3 s — only on the very first load, never again.
        if (!hasSucceededRef.current) {
          const retrySeq = seq;
          setTimeout(() => {
            if (retrySeq === seqRef.current) void refresh();
          }, 3000);
        }
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const { byId, bySystemKey } = useMemo(() => {
    const byId = new Map<string, TaxonomyEntry>();
    const bySystemKey = new Map<string, TaxonomyEntry>();
    for (const group of groups) {
      for (const cat of group.categories) {
        const entry = { ...cat, group };
        byId.set(cat.id, entry);
        if (cat.systemKey) bySystemKey.set(cat.systemKey, entry);
      }
    }
    return { byId, bySystemKey };
  }, [groups]);

  const value = useMemo(
    () => ({ groups, loading, error, byId, bySystemKey, refresh }),
    [groups, loading, error, byId, bySystemKey, refresh],
  );

  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>;
}

export function useTaxonomy(): TaxonomyContextValue {
  const ctx = useContext(TaxonomyContext);
  if (!ctx) throw new Error('useTaxonomy must be used inside TaxonomyProvider');
  return ctx;
}

// Icon for a taxonomy entry: system glyph by systemKey; custom → emoji or generic.
export function taxonomyIcon(entry: { systemKey: string | null; emoji: string | null }): React.ReactNode {
  if (entry.systemKey) return getCategoryDisplay(entry.systemKey).icon;
  if (entry.emoji) return <span className="text-[15px] leading-none" aria-hidden>{entry.emoji}</span>;
  return <Receipt size={15} />;
}

// Option label — custom categories show their emoji prefix in pickers.
export function categoryOptionLabel(cat: { name: string; systemKey: string | null; emoji: string | null }): string {
  return cat.systemKey === null && cat.emoji ? `${cat.emoji} ${cat.name}` : cat.name;
}

// Picker source: groups in sortOrder with disabled categories hidden; groups
// left with no enabled categories are dropped entirely.
export function usePickerGroups(): Array<{ group: TaxonomyGroup; categories: TaxonomyCategory[] }> {
  const { groups } = useTaxonomy();
  return useMemo(
    () =>
      groups
        .map((group) => ({ group, categories: group.categories.filter((c) => !c.disabled) }))
        .filter((g) => g.categories.length > 0),
    [groups],
  );
}

// Display helper for transaction rows: id → generic fallback.
export function useCategoryDisplay(): (tx: { categoryId?: string | null }) => { label: string; icon: React.ReactNode } {
  const { byId } = useTaxonomy();
  return useCallback(
    (tx) => {
      const entry = tx.categoryId ? byId.get(tx.categoryId) : undefined;
      if (entry) return { label: entry.name, icon: taxonomyIcon(entry) };
      return { label: 'Other', icon: <Receipt size={15} /> };
    },
    [byId],
  );
}
