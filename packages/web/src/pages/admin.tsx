import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Modal, Skeleton } from '../components/uikit';
import { AdminShell } from '../components/admin/admin-shell';
import { PlanChip } from '../components/admin/plan-chip';
import { useAuth } from '../lib/auth';
import { RowMenu } from '../components/admin/row-menu';
import { DeleteTenantModal } from '../components/admin/delete-tenant-modal';

type AdminUser = Awaited<ReturnType<typeof api.adminGetUsers>>['users'][number];
type Totals = Awaited<ReturnType<typeof api.adminGetUsers>>['totals'];
type SortKey = 'createdAt' | 'lastLoginAt' | 'accountCount' | 'spend30d';

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
// Sub-cent amounts are common here — "$0.00" would hide real spend.
const fmtUsd = (v: string | number) => {
  const n = Number(v);
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
};

export function Admin() {
  const [, navigate] = useLocation();
  const [totals, setTotals] = useState<Totals | null>(null);
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // Last-login default: puts active users on top instead of empty fresh signups.
  const [sortKey, setSortKey] = useState<SortKey>('lastLoginAt');
  const [sortDesc, setSortDesc] = useState(true);
  const [pauseTarget, setPauseTarget] = useState<AdminUser | null>(null);
  const { tenant: myTenant } = useAuth();
  const [rowBusy, setRowBusy] = useState('');       // tenantId being paused/resumed
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  // Tenants containing an admin user can't be deleted (server enforces too).
  const adminTenants = useMemo(() => new Set(rows.filter((r) => r.isAdmin).map((r) => r.tenantId)), [rows]);
  const tenantUserCount = (tenantId: string) => rows.filter((r) => r.tenantId === tenantId).length;

  const togglePause = async (u: AdminUser) => {
    setRowBusy(u.tenantId);
    setActionError('');
    try {
      await api.adminSetTenantDisabled(u.tenantId, !u.disabledAt);
      await load();
    } catch (e) {
      setActionError(`${u.email}: ${e instanceof Error ? e.message : 'Failed'}`);
    } finally {
      setRowBusy('');
    }
  };

  const load = () => {
    setError('');
    return api
      .adminGetUsers()
      .then((r) => {
        setTotals(r.totals);
        setRows(r.users);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.email.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))
      : rows;
    const val = (r: AdminUser) =>
      sortKey === 'accountCount' ? r.accountCount
      : sortKey === 'spend30d' ? Number(r.spend30d)
      : new Date(r[sortKey] ?? 0).getTime();
    return [...filtered].sort((a, b) => (sortDesc ? val(b) - val(a) : val(a) - val(b)));
  }, [rows, search, sortKey, sortDesc]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const sortMark = (k: SortKey) => (sortKey === k ? (sortDesc ? ' ↓' : ' ↑') : '');

  // Plan buckets count tenants (billing is per tenant), so a multi-user tenant
  // isn't double-counted — hence the "tenants" labels.
  const stats: Array<{ label: string; value: number }> = totals
    ? [
        { label: 'Users', value: totals.users },
        { label: 'Paid tenants', value: totals.paid },
        { label: 'Comped tenants', value: totals.comped },
        { label: 'Free tenants', value: totals.free },
        { label: 'Demo tenants', value: totals.demo },
        { label: 'Connected accounts', value: totals.connectedAccounts },
      ]
    : [];

  const thSort = 'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted';
  const sortBtn = 'ui-focus rounded-ui-xs touch-target-inline whitespace-nowrap font-bold uppercase tracking-[0.12em] hover:text-content transition-colors';

  if (error) {
    return (
      <AdminShell subtitle="Users, activity, and complimentary Pro grants. Billing itself lives in Stripe.">
        <div className="mt-7 rounded-ui-md border border-negative/25 bg-negative-soft px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] font-medium text-negative">Could not load users — {error}</p>
          <Button variant="secondary" size="sm" onClick={() => { setLoading(true); void load(); }}>Retry</Button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell subtitle="Users, activity, and complimentary Pro grants. Billing itself lives in Stripe.">
      {/* Totals */}
      <div className="mt-7 grid grid-cols-3 sm:grid-cols-6 gap-x-6 gap-y-5">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-ui-md" />)
          : stats.map((s) => (
              // flex-col justify-between keeps values on one baseline when a label wraps to two lines.
              <div key={s.label} className="border-l-2 border-line pl-3.5 flex flex-col justify-between">
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">{s.label}</div>
                <div className="mt-1 font-editorial text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum">{s.value}</div>
              </div>
            ))}
      </div>

      {/* Search */}
      <div className="mt-7 max-w-[340px]">
        <div className="flex items-center gap-2 px-3 rounded-ui-md border border-line bg-panel focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft transition-[border-color,box-shadow]">
          <Search size={15} className="text-content-muted shrink-0" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or name…"
            aria-label="Search users"
            className="touch-target flex-1 min-w-0 h-10 bg-transparent text-[14px] text-content placeholder:text-content-muted focus:outline-none"
          />
        </div>
      </div>

      {actionError && <p className="mt-3 text-[12.5px] text-negative">{actionError}</p>}

      {/* Users table — click a row for the full detail page */}
      <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm overflow-x-auto">
        <table className="w-full text-[13.5px]" data-testid="admin-users-table">
          <thead>
            <tr className="border-b border-line text-left">
              <th className={thSort}>User</th>
              <th className={thSort}>Plan</th>
              <th className={thSort}>
                <button type="button" className={sortBtn} onClick={() => toggleSort('createdAt')}>
                  Signed up{sortMark('createdAt')}
                </button>
              </th>
              <th className={thSort}>
                <button type="button" className={sortBtn} onClick={() => toggleSort('lastLoginAt')}>
                  Last login{sortMark('lastLoginAt')}
                </button>
              </th>
              <th className={`${thSort} text-right`}>
                <button type="button" className={sortBtn} onClick={() => toggleSort('accountCount')}>
                  Accounts{sortMark('accountCount')}
                </button>
              </th>
              <th className={`${thSort} text-right`}>
                <button type="button" className={sortBtn} onClick={() => toggleSort('spend30d')}>
                  Spend 30d{sortMark('spend30d')}
                </button>
              </th>
              <th className={`${thSort} text-right`}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8">
                  <Skeleton className="h-24 rounded-ui-md" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-content-muted">
                  {search.trim() ? 'No users match your search.' : 'No users yet.'}
                </td>
              </tr>
            ) : (
              visible.map((u) => (
                <tr
                  key={u.userId}
                  onClick={() => navigate(`/admin/users/${u.tenantId}`)}
                  className="border-b border-line last:border-b-0 hover:bg-canvas-sunken/50 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/users/${u.tenantId}`} className="font-semibold text-content hover:underline" onClick={(e) => e.stopPropagation()}>
                      {u.email}
                    </Link>
                    {u.name && <div className="text-[12px] text-content-muted">{u.name}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PlanChip planSource={u.planSource} compedUntil={u.compedUntil} />
                      {u.disabledAt && (
                        <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold bg-caution-soft text-caution">Paused</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 ui-tnum text-content-secondary">{fmtDate(u.createdAt)}</td>
                  {/* Zero/empty values print faint so rows with real activity pop out of the scan. */}
                  <td className={`px-4 py-3 ui-tnum ${u.lastLoginAt ? 'text-content-secondary' : 'text-content-faint'}`}>{fmtDate(u.lastLoginAt)}</td>
                  <td className={`px-4 py-3 ui-tnum text-right${u.accountCount === 0 ? ' text-content-faint' : ''}`}>{u.accountCount}</td>
                  <td className={`px-4 py-3 ui-tnum text-right${Number(u.spend30d) === 0 ? ' text-content-faint' : ''}`}>{fmtUsd(u.spend30d)}</td>
                  <td className="px-4 py-3 text-right">
                    <RowMenu
                      label={`Actions for ${u.email}`}
                      items={[
                        { label: 'Open', onSelect: () => navigate(`/admin/users/${u.tenantId}`) },
                        {
                          label: rowBusy === u.tenantId ? 'Working…' : u.disabledAt ? 'Resume account' : 'Pause account…',
                          // Resuming is restorative and runs directly; pausing confirms first.
                          onSelect: () => (u.disabledAt ? void togglePause(u) : setPauseTarget(u)),
                          // Server allows resuming your own tenant — only self-pause is blocked.
                          disabled: rowBusy === u.tenantId || (u.tenantId === myTenant?.id && !u.disabledAt),
                          disabledReason: u.tenantId === myTenant?.id && !u.disabledAt ? "You can't pause your own account" : undefined,
                        },
                        {
                          label: 'Delete…',
                          tone: 'danger',
                          onSelect: () => setDeleteTarget(u),
                          disabled: u.tenantId === myTenant?.id || adminTenants.has(u.tenantId),
                          disabledReason: u.tenantId === myTenant?.id
                            ? "You can't delete your own account"
                            : 'Tenant has an admin user — remove their admin role first',
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pauseTarget && (
        <Modal open onClose={() => setPauseTarget(null)} title="Pause this account?">
          <p className="text-[13.5px] text-content-secondary leading-[1.55]">
            Pausing <b className="text-content">{pauseTarget.email}</b> stops account syncing and action
            generation. They can still log in and view their data.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPauseTarget(null)}>Cancel</Button>
            <Button size="sm" onClick={() => { const u = pauseTarget; setPauseTarget(null); void togglePause(u); }}>
              Pause account
            </Button>
          </div>
        </Modal>
      )}
      {deleteTarget && (
        <DeleteTenantModal
          open
          onClose={() => setDeleteTarget(null)}
          tenantId={deleteTarget.tenantId}
          primaryEmail={deleteTarget.email}
          userCount={tenantUserCount(deleteTarget.tenantId)}
          onDeleted={() => { setDeleteTarget(null); void load(); }}
        />
      )}
    </AdminShell>
  );
}
