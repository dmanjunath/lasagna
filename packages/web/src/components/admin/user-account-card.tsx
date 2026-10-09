import { useState } from 'react';
import { api } from '../../lib/api';
import { formatInstant } from '../../lib/utils';
import { Button, Input, Field, useToast } from '../uikit';
import { useConfirm } from '../ds';
import { OptionMenu } from '../common/OptionMenu';

type CardUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  hasWorkosIdentity: boolean;
};

const fmtDate = (v: string | null) =>
  v ? formatInstant(v, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

/** Always-editable identity + auth actions for one user. Re-mount (via key) after saves. */
export function UserAccountCard({ u, selfId, authMode, onChanged }: {
  u: CardUser;
  selfId: string | undefined;
  authMode: 'workos' | 'local';
  onChanged: () => void;
}) {
  const [name, setName] = useState(u.name ?? '');
  const [email, setEmail] = useState(u.email);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  // Household membership tooling (resolve merges / mistakes).
  const [role, setRole] = useState<'' | 'owner' | 'member'>('');
  const [moveTenantId, setMoveTenantId] = useState('');

  const isSelf = u.id === selfId;
  // Trim to mirror the server's normalization — otherwise a whitespace-only
  // change saves a no-op and the Save bar never clears (no remount).
  const dirty = name.trim() !== (u.name ?? '') || email.trim().toLowerCase() !== u.email;

  const resetBlocked =
    authMode !== 'workos' ? 'Requires WorkOS auth mode (not configured on this server)'
    : !u.hasWorkosIdentity ? 'Not WorkOS-linked, so no reset email can be sent'
    : '';
  const adminBlocked = isSelf ? "You can't change your own admin status" : u.isDemo ? 'Demo users cannot be admins' : '';

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const patch: { name?: string | null; email?: string } = {};
      if (name.trim() !== (u.name ?? '')) patch.name = name.trim();
      if (email.trim().toLowerCase() !== u.email) patch.email = email;
      await api.adminUpdateUser(u.id, patch);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  // A plain yes/no per action. A stale card error is cleared first so it
  // can't masquerade as belonging to the action being confirmed.
  const openConfirm = async (kind: 'reset' | 'signout' | 'admin' | 'remove') => {
    setErr('');
    const ok = await confirm(
      kind === 'reset' ? {
        title: 'Send password reset?',
        body: <>Email <b className="text-content">{u.email}</b> a WorkOS password-reset link?</>,
        confirmLabel: 'Send reset email',
      } : kind === 'signout' ? {
        title: 'Sign out everywhere?',
        body: <>
          Immediately invalidate every signed-in session for <b className="text-content">{u.email}</b>? They stay signed out until they log in again.
          {isSelf && <> <b className="text-content">This is you</b>. You will be signed out of this session too.</>}
        </>,
        confirmLabel: 'Sign out everywhere',
      } : kind === 'remove' ? {
        title: 'Remove this user?',
        body: <>Delete the login for <b className="text-content">{u.email}</b> and their private chat + personal profile? Their household's pooled financial data stays intact. This can't be undone.</>,
        confirmLabel: 'Remove user',
        destructive: true,
      } : u.isAdmin ? {
        title: 'Revoke admin access?',
        body: <>Remove admin access from <b className="text-content">{u.email}</b>? Takes effect on their very next request.</>,
        confirmLabel: 'Revoke admin',
      } : {
        title: 'Grant admin access?',
        body: <>Give <b className="text-content">{u.email}</b> full operator access, including this admin console?</>,
        confirmLabel: 'Make admin',
      },
    );
    if (ok) await runConfirm(kind);
  };

  const runConfirm = async (kind: 'reset' | 'signout' | 'admin' | 'remove') => {
    setBusy(true); setErr('');
    try {
      if (kind === 'reset') {
        await api.adminSendPasswordReset(u.id);
        toast({ tone: 'positive', title: `Reset email sent to ${u.email}` });
      } else if (kind === 'signout') {
        await api.adminRevokeSessions(u.id);
        toast({ tone: 'positive', title: 'Signed out of all devices' });
      } else if (kind === 'admin') {
        await api.adminUpdateUser(u.id, { isAdmin: !u.isAdmin });
        onChanged();
      } else if (kind === 'remove') {
        await api.adminRemoveUser(u.id);
        toast({ tone: 'positive', title: `Removed ${u.email}` });
        onChanged();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async () => {
    if (!role) return;
    setBusy(true); setErr('');
    try {
      await api.adminSetUserRole(u.id, role);
      toast({ tone: 'positive', title: `Role set to ${role}` });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const moveTenant = async () => {
    const target = moveTenantId.trim();
    if (!target) return;
    setBusy(true); setErr('');
    try {
      await api.adminMoveUserToTenant(u.id, target);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const actionRow = 'flex flex-wrap items-center justify-between gap-3 pt-3.5 mt-3.5 border-t border-line';

  return (
    <div className="rounded-ui-md border border-line bg-canvas p-4" data-testid={`user-card-${u.email}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-content-muted">
        <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold uppercase bg-canvas-sunken text-content-secondary">
          {u.hasWorkosIdentity ? 'Google / WorkOS' : 'password'}
        </span>
        {u.isAdmin && <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold uppercase bg-[var(--ui-accent-soft)] text-[rgb(var(--ui-accent-ink))]">admin</span>}
        {u.isDemo && <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold uppercase bg-canvas-sunken text-content-muted">demo</span>}
        {isSelf && <span className="inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-bold uppercase bg-canvas-sunken text-content-muted">you</span>}
        <span className="ml-auto ui-tnum">last login {fmtDate(u.lastLoginAt)}</span>
      </div>

      {/* Enter in either field submits (implicit form submission → the Save button below). */}
      <form onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) void save(); }}>
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="No name" />
          </Field>
          <Field label="Email" hint={u.hasWorkosIdentity ? 'Managed by WorkOS/Google. Change it there.' : undefined}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={u.hasWorkosIdentity} />
          </Field>
        </div>
        {dirty && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setName(u.name ?? ''); setEmail(u.email); setErr(''); }}>Discard</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}
      </form>

      {/* Errors live next to the fields/Save bar they belong to, not below the action rows. */}
      {err && <p className="mt-2.5 text-[12.5px] text-negative">{err}</p>}

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Password reset</div>
          <p className="text-[11.5px] text-content-muted">{resetBlocked || 'Emails a WorkOS reset link. Their current password keeps working until they finish it.'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!resetBlocked || busy} title={resetBlocked || undefined} onClick={() => void openConfirm('reset')}>
          Send reset email
        </Button>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Sessions</div>
          <p className="text-[11.5px] text-content-muted">Invalidates every signed-in device immediately.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openConfirm('signout')}>
          Sign out everywhere
        </Button>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Administrator</div>
          <p className="text-[11.5px] text-content-muted">{adminBlocked || 'Full operator access. Takes effect immediately.'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!adminBlocked || busy} title={adminBlocked || undefined} onClick={() => void openConfirm('admin')}>
          {u.isAdmin ? 'Revoke admin' : 'Make admin'}
        </Button>
      </div>

      {/* ── Household membership tooling ── */}
      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Household role</div>
          <p className="text-[11.5px] text-content-muted">Change this user's role within their household.</p>
        </div>
        <div className="flex items-center gap-2">
          <OptionMenu
            ariaLabel="Household role"
            value={role}
            triggerLabel={role ? undefined : 'Set role'}
            options={[
              { value: 'owner', label: 'Owner' },
              { value: 'member', label: 'Member' },
            ]}
            onChange={setRole}
            toolbar={{ count: 0 }}
          />
          <Button variant="secondary" size="sm" disabled={!role || busy} onClick={() => void changeRole()}>
            Apply
          </Button>
        </div>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Move to tenant</div>
          <p className="text-[11.5px] text-content-muted">Reassign this user to a different household by tenant id.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={moveTenantId} onChange={(e) => setMoveTenantId(e.target.value)} placeholder="tenant uuid" className="h-9 w-[200px]" />
          <Button variant="secondary" size="sm" disabled={!moveTenantId.trim() || busy} onClick={() => void moveTenant()}>
            Move
          </Button>
        </div>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Remove user</div>
          <p className="text-[11.5px] text-content-muted">Deletes this login and their private data. Pooled household data is untouched.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openConfirm('remove')}>
          Remove user
        </Button>
      </div>

    </div>
  );
}
