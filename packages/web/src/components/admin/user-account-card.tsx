import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Field, Modal } from '../uikit';

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
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

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
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<null | 'reset' | 'signout' | 'admin'>(null);

  const isSelf = u.id === selfId;
  // Trim to mirror the server's normalization — otherwise a whitespace-only
  // change saves a no-op and the Save bar never clears (no remount).
  const dirty = name.trim() !== (u.name ?? '') || email.trim().toLowerCase() !== u.email;

  const resetBlocked =
    authMode !== 'workos' ? 'Requires WorkOS auth mode (not configured on this server)'
    : !u.hasWorkosIdentity ? 'Not WorkOS-linked — no reset email can be sent'
    : '';
  const adminBlocked = isSelf ? "You can't change your own admin status" : u.isDemo ? 'Demo users cannot be admins' : '';

  const save = async () => {
    setBusy(true); setErr(''); setNotice('');
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

  // Clear stale card-level errors/notices so they can't masquerade as
  // belonging to the confirmation being opened.
  const openConfirm = (kind: 'reset' | 'signout' | 'admin') => {
    setErr('');
    setNotice('');
    setConfirm(kind);
  };

  const runConfirm = async () => {
    setBusy(true); setErr(''); setNotice('');
    try {
      if (confirm === 'reset') {
        await api.adminSendPasswordReset(u.id);
        setNotice(`Reset email sent to ${u.email}`);
      } else if (confirm === 'signout') {
        await api.adminRevokeSessions(u.id);
        setNotice('Signed out of all devices');
      } else if (confirm === 'admin') {
        await api.adminUpdateUser(u.id, { isAdmin: !u.isAdmin });
        onChanged();
      }
      setConfirm(null);
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
          <Field label="Email" hint={u.hasWorkosIdentity ? 'Managed by WorkOS/Google — change it there' : undefined}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={u.hasWorkosIdentity} />
          </Field>
        </div>
        {dirty && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => { setName(u.name ?? ''); setEmail(u.email); setErr(''); setNotice(''); }}>Discard</Button>
            <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}
      </form>

      {/* Feedback lives next to the fields/Save bar it belongs to, not below the action rows. */}
      {err && <p className="mt-2.5 text-[12.5px] text-negative">{err}</p>}
      {notice && <p className="mt-2.5 text-[12.5px] text-positive">✓ {notice}</p>}

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Password reset</div>
          <p className="text-[11.5px] text-content-muted">{resetBlocked || 'Emails a WorkOS reset link. Their current password keeps working until they finish it.'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!resetBlocked || busy} title={resetBlocked || undefined} onClick={() => openConfirm('reset')}>
          Send reset email
        </Button>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Sessions</div>
          <p className="text-[11.5px] text-content-muted">Invalidates every signed-in device immediately.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => openConfirm('signout')}>
          Sign out everywhere
        </Button>
      </div>

      <div className={actionRow}>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-content">Administrator</div>
          <p className="text-[11.5px] text-content-muted">{adminBlocked || 'Full operator access — takes effect immediately.'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled={!!adminBlocked || busy} title={adminBlocked || undefined} onClick={() => openConfirm('admin')}>
          {u.isAdmin ? 'Revoke admin' : 'Make admin'}
        </Button>
      </div>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'reset' ? 'Send password reset?' : confirm === 'signout' ? 'Sign out everywhere?' : u.isAdmin ? 'Revoke admin access?' : 'Grant admin access?'}
      >
        <p className="text-[13.5px] text-content-secondary leading-[1.55]">
          {confirm === 'reset' && <>Email <b className="text-content">{u.email}</b> a WorkOS password-reset link?</>}
          {confirm === 'signout' && <>
            Immediately invalidate every signed-in session for <b className="text-content">{u.email}</b>? They stay signed out until they log in again.
            {isSelf && <> <b className="text-content">This is you</b> — you will be signed out of this session too.</>}
          </>}
          {confirm === 'admin' && (u.isAdmin
            ? <>Remove admin access from <b className="text-content">{u.email}</b>? Takes effect on their very next request.</>
            : <>Give <b className="text-content">{u.email}</b> full operator access, including this admin console?</>)}
        </p>
        {err && <p className="mt-2 text-[12.5px] text-negative">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
          <Button size="sm" disabled={busy} onClick={runConfirm}>
            {busy ? 'Working…' : confirm === 'reset' ? 'Send reset email' : confirm === 'signout' ? 'Sign out everywhere' : u.isAdmin ? 'Revoke admin' : 'Make admin'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
