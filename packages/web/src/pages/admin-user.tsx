import { useEffect, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, PauseCircle, PlayCircle, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Modal, Skeleton } from '../components/uikit';
import { cn } from '../lib/utils';
import { AdminShell } from '../components/admin/admin-shell';
import { PlanChip } from '../components/admin/plan-chip';
import { CompControl } from '../components/admin/comp-control';
import { UserAccountCard } from '../components/admin/user-account-card';
import { DeleteTenantModal } from '../components/admin/delete-tenant-modal';

type TenantDetail = Awaited<ReturnType<typeof api.adminGetTenantDetail>>;

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
// Sub-cent amounts are common here — "$0.00" would hide real spend.
const fmtUsd = (v: string | number) => {
  const n = Number(v);
  return `$${n.toFixed(n > 0 && n < 0.01 ? 4 : 2)}`;
};
const fmtBal = (v: string | null) =>
  v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function AdminUser() {
  const [, params] = useRoute('/admin/users/:tenantId');
  const tenantId = params?.tenantId ?? '';
  const [, navigate] = useLocation();
  const { user: me } = useAuth();

  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pauseConfirm, setPauseConfirm] = useState(false);

  const load = () =>
    api.adminGetTenantDetail(tenantId).then((d) => { setDetail(d); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));

  useEffect(() => {
    if (tenantId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const primaryEmail = detail?.users[0]?.email ?? 'this user';
  const disabled = detail?.tenant.disabledAt != null;
  const userCount = detail?.users.length ?? 0;
  // Surface the server's delete guards up front instead of after typing the confirmation.
  const deleteBlocked = !detail
    ? ''
    : detail.isSelf
      ? "This is your own account — it can't be deleted from here."
      : detail.users.some((u) => u.isAdmin)
        ? 'This user is an administrator. Remove their admin role before deleting.'
        : '';

  const toggleDisabled = async () => {
    if (!detail) return;
    setBusy(true);
    setError('');
    try {
      await api.adminSetTenantDisabled(tenantId, !disabled);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const sectionTitle = 'text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted';

  return (
    <AdminShell subtitle="User detail — plan, connections, activity, and controls.">
      <div className="mt-7">
        <button
          onClick={() => navigate('/admin')}
          className="ui-focus rounded-ui-xs touch-target-inline inline-flex items-center gap-1.5 text-[13px] font-semibold text-content-secondary hover:text-content transition-colors"
        >
          <ArrowLeft size={15} /> All users
        </button>
      </div>

      {error && !detail && (
        <div className="mt-6 rounded-ui-md border border-negative/25 bg-negative-soft px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] font-medium text-negative">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => { setError(''); void load(); }}>Retry</Button>
        </div>
      )}
      {/* Skeletons mirror the identity card + account card shapes below. */}
      {!detail && !error && (
        <div className="mt-4 grid gap-5">
          <Skeleton className="h-24 rounded-ui-xl" />
          <Skeleton className="h-64 rounded-ui-xl" />
        </div>
      )}

      {detail && (
        <>
          {/* Identity + status */}
          <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
            <div className="min-w-0">
              <h2 className="font-editorial text-[22px] font-bold tracking-[-0.015em] truncate">{primaryEmail}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PlanChip planSource={detail.tenant.planSource} compedUntil={detail.tenant.compedUntil} />
                {disabled && (
                  <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-bold ui-tnum bg-caution-soft text-caution">
                    Paused since {fmtDate(detail.tenant.disabledAt)}
                  </span>
                )}
                {/* One span so a wrap can't strand the "·" at the start of a line. */}
                <span className="text-[12.5px] text-content-muted ui-tnum">
                  member since {fmtDate(detail.tenant.createdAt)} · {fmtUsd(Number(detail.spend30d.llmCost) + Number(detail.spend30d.plaidCost))} spend in 30d
                </span>
              </div>
            </div>
          </div>

          {/* Mutation/background-reload failures for an already-loaded page */}
          {error && <p className="mt-3 text-[12.5px] text-negative">{error}</p>}

          {/* Account & security */}
          <div className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
            <div className={sectionTitle}>Account &amp; security{detail.users.length > 1 ? ` (${detail.users.length} users)` : ''}</div>
            <div className="mt-3 flex flex-col gap-3">
              {detail.users.map((u) => (
                <UserAccountCard
                  key={`${u.id}:${u.name}:${u.email}:${String(u.isAdmin)}`}
                  u={u}
                  selfId={me?.id}
                  authMode={detail.authMode}
                  onChanged={() => void load()}
                />
              ))}
            </div>
          </div>

          {/* Billing */}
          <div className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
            <div className={sectionTitle}>Billing</div>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-content">Complimentary Pro</div>
                <p className="text-[11.5px] text-content-muted">Grant Pro without touching Stripe. Expires on its own.</p>
              </div>
              <CompControl tenantId={tenantId} email={primaryEmail} comped={detail.tenant.planSource === 'comped'} onDone={() => void load()} />
            </div>
            <div className="mt-3.5 pt-3.5 border-t border-line flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-content">Stripe</div>
                <p className="text-[11.5px] text-content-muted">
                  {detail.stripe ? `Customer ${detail.stripe.customerId}` : 'No Stripe customer — this tenant has never started checkout.'}
                </p>
              </div>
              {detail.stripe && (
                <div className="flex items-center gap-2">
                  <a
                    href={`${detail.stripe.dashboardUrl}/customers/${detail.stripe.customerId}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center h-9 px-3 rounded-ui-md border border-line-strong bg-panel text-[12.5px] font-semibold text-content hover:bg-canvas-sunken transition-colors"
                  >
                    Open customer ↗
                  </a>
                  {detail.stripe.subscriptionId && (
                    <a
                      href={`${detail.stripe.dashboardUrl}/subscriptions/${detail.stripe.subscriptionId}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center h-9 px-3 rounded-ui-md border border-line-strong bg-panel text-[12.5px] font-semibold text-content hover:bg-canvas-sunken transition-colors"
                    >
                      Subscription ↗
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3.5 pt-3.5 border-t border-line flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-content">{disabled ? 'Paused' : 'Pause account'}</div>
                <p className="text-[11.5px] text-content-muted max-w-[52ch]">
                  {detail.isSelf && !disabled
                    ? 'This is your own account — pausing is disabled.'
                    : disabled
                      ? 'Syncing and action generation are stopped. Login and read access still work.'
                      : 'Stops syncing and action generation without blocking their login or data access.'}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || (detail.isSelf && !disabled)}
                onClick={() => (disabled ? void toggleDisabled() : setPauseConfirm(true))}
                data-testid="toggle-disabled"
              >
                {disabled ? <><PlayCircle size={15} className="mr-1.5" /> Resume</> : <><PauseCircle size={15} className="mr-1.5" /> Pause</>}
              </Button>
            </div>
          </div>

          {/* Spend + inventory grid */}
          <div className="mt-5 grid lg:grid-cols-2 gap-5">
            <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5">
              <div className="flex items-center justify-between gap-3">
                <div className={sectionTitle}>Spend · last 30 days</div>
                <Link href="/admin/spend" className="ui-focus rounded-ui-xs text-[12px] font-semibold text-content-secondary hover:text-content transition-colors">
                  All spend →
                </Link>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="rounded-ui-md border border-line px-3.5 py-3">
                  <div className="text-[11px] font-semibold text-content-muted">LLM</div>
                  {/* Zero spend renders quiet so a real number reads at a glance. */}
                  <div className={cn('mt-0.5 font-editorial text-[22px] font-extrabold ui-tnum', Number(detail.spend30d.llmCost) === 0 && 'text-content-muted')}>{fmtUsd(detail.spend30d.llmCost)}</div>
                </div>
                <div className="rounded-ui-md border border-line px-3.5 py-3">
                  <div className="text-[11px] font-semibold text-content-muted">Plaid</div>
                  <div className={cn('mt-0.5 font-editorial text-[22px] font-extrabold ui-tnum', Number(detail.spend30d.plaidCost) === 0 && 'text-content-muted')}>{fmtUsd(detail.spend30d.plaidCost)}</div>
                </div>
              </div>

              <div className={`${sectionTitle} mt-6`}>Institutions ({detail.plaidItems.length})</div>
              <div className="mt-2 flex flex-col gap-1.5">
                {detail.plaidItems.length === 0 && <p className="text-[13px] text-content-muted">None connected.</p>}
                {detail.plaidItems.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate" title={i.institutionName || 'Unknown institution'}>{i.institutionName || 'Unknown institution'} · {i.status}</span>
                    <span className="text-content-muted ui-tnum shrink-0">synced {fmtDate(i.lastSyncedAt)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5">
              <div className={sectionTitle}>Accounts ({detail.accounts.length})</div>
              <div className="mt-2 flex flex-col gap-1.5 max-h-[300px] overflow-y-auto pr-1">
                {detail.accounts.length === 0 && <p className="text-[13px] text-content-muted">No accounts.</p>}
                {detail.accounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate" title={a.name}>
                      {a.name} <span className="text-content-muted">· {a.subtype || a.type}</span>
                      {a.frozen && <span className="ml-1.5 text-[10.5px] font-bold uppercase text-caution">frozen</span>}
                    </span>
                    <span className={cn('ui-tnum shrink-0', a.balance == null && 'text-content-faint')}>{fmtBal(a.balance)}</span>
                  </div>
                ))}
              </div>

              <div className={`${sectionTitle} mt-6`}>Recent activity</div>
              <div className="mt-2 flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1">
                {detail.recentActivity.length === 0 && <p className="text-[13px] text-content-muted">No metered activity yet.</p>}
                {detail.recentActivity.map((ev, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="truncate text-content-secondary">
                      {ev.source}{ev.model ? ` · ${ev.model.split('/').pop()}` : ''}
                    </span>
                    <span className="text-content-muted ui-tnum shrink-0">
                      {fmtUsd(ev.costUsd)} · {new Date(ev.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div className="mt-5 rounded-ui-xl border border-negative/25 bg-negative-soft px-5 py-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-negative">Danger zone</div>
            <p className="mt-1.5 text-[12.5px] text-content-secondary leading-[1.5] max-w-[68ch]">
              {userCount > 1
                ? `Deletes all ${userCount} users in this tenant and every account, transaction, and thread. `
                : 'Deletes this user and every account, transaction, and thread in their tenant. '}
              Spend history is kept (detached). Cannot be undone.
            </p>
            {deleteBlocked && <p className="mt-1.5 text-[12.5px] font-medium text-content-secondary">{deleteBlocked}</p>}
            <Button
              variant="secondary"
              size="sm"
              className="mt-2.5 !text-negative"
              disabled={!!deleteBlocked}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 size={14} className="mr-1.5" /> {userCount > 1 ? `Delete ${userCount} users & data` : 'Delete user & data'}
            </Button>
          </div>

          <Modal open={pauseConfirm} onClose={() => setPauseConfirm(false)} title="Pause this account?">
            <p className="text-[13.5px] text-content-secondary leading-[1.55]">
              Pausing <b className="text-content">{primaryEmail}</b> stops account syncing and action
              generation. They can still log in and view their data.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPauseConfirm(false)}>Cancel</Button>
              <Button size="sm" onClick={() => { setPauseConfirm(false); void toggleDisabled(); }}>Pause account</Button>
            </div>
          </Modal>

          <DeleteTenantModal
            open={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            tenantId={tenantId}
            primaryEmail={primaryEmail}
            userCount={userCount}
            onDeleted={() => navigate('/admin')}
          />
        </>
      )}
    </AdminShell>
  );
}
