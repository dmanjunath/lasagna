import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Modal } from '../uikit';

/**
 * Comp grant (with a days field, default 365) or revoke, behind a confirmation
 * that names the user and the consequence. Used on the user list rows and the
 * tenant detail header.
 */
export function CompControl({ tenantId, email, comped, onDone }: {
  tenantId: string;
  email: string;
  comped: boolean;
  onDone: () => void;
}) {
  const [days, setDays] = useState('365');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const parsedDays = parseInt(days, 10);
  // Mirror the server's bounds so the confirm modal can't promise a grant that will 400.
  const daysValid = parsedDays > 0 && parsedDays <= 3650;

  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.adminCompTenant(tenantId, comped ? 0 : parsedDays);
      setConfirming(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      {comped ? (
        <Button variant="secondary" size="sm" onClick={() => { setErr(''); setConfirming(true); }}>
          Revoke
        </Button>
      ) : (
        <>
          <Input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            aria-label="Comp duration in days"
            className="w-[76px] text-right ui-tnum"
          />
          <span className="text-[12px] text-content-muted">days</span>
          <Button variant="secondary" size="sm" disabled={!daysValid} title={daysValid ? undefined : 'Between 1 and 3650 days'} onClick={() => { setErr(''); setConfirming(true); }}>
            Comp
          </Button>
        </>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title={comped ? 'Revoke complimentary Pro?' : 'Grant complimentary Pro?'}>
        <p className="text-[13.5px] text-content-secondary leading-[1.55]">
          {comped ? (
            <>Remove complimentary Pro from <b className="text-content">{email}</b>? Pro features stop immediately and accounts over the free limit are frozen again.</>
          ) : (
            <>Give <b className="text-content">{email}</b> Pro free for <b className="text-content ui-tnum">{parsedDays} days</b>? It expires on its own and does not affect Stripe billing.</>
          )}
        </p>
        {err && <p className="mt-2 text-[12.5px] text-negative">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? 'Working…' : comped ? 'Revoke comp' : `Comp for ${parsedDays} days`}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
