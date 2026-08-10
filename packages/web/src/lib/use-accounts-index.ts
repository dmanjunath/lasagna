import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

// ---------------------------------------------------------------------------
// useAccountsIndex — a flat account→institution identity index built from
// /plaid/items. Module-level promise cache so multiple mounts (filter panel,
// detail modal, …) share one request per session.
// ---------------------------------------------------------------------------

export interface AccountIndexEntry {
  id: string;
  name: string;
  mask: string | null;
  institution: string;
  isManual: boolean;
}

let cache: Promise<AccountIndexEntry[]> | null = null;

function fetchIndex(): Promise<AccountIndexEntry[]> {
  if (!cache) {
    cache = api
      .getItems()
      .then(({ items }) =>
        items.flatMap((item) =>
          item.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            mask: a.mask,
            institution: item.institutionName || 'Manual',
            isManual: item.institutionId === 'manual',
          })),
        ),
      )
      .catch((err) => {
        cache = null; // allow a later mount to retry
        throw err;
      });
  }
  return cache;
}

export function useAccountsIndex(): {
  list: AccountIndexEntry[];
  byId: Map<string, AccountIndexEntry>;
} {
  const [list, setList] = useState<AccountIndexEntry[]>([]);
  useEffect(() => {
    let alive = true;
    fetchIndex()
      .then((entries) => { if (alive) setList(entries); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  return { list, byId };
}
