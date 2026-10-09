import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, useToast } from '../uikit';
import { useConfirm } from '../ds';

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
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  const parsedDays = parseInt(days, 10);
  // Mirror the server's bounds so the confirmation can't promise a grant that will 400.
  const daysValid = parsedDays > 0 && parsedDays <= 3650;

  const run = async () => {
    const ok = await confirm(comped ? {
      title: 'Revoke complimentary Pro?',
      body: <>Remove complimentary Pro from <b className="text-content">{email}</b>? Pro features stop immediately and accounts at institutions past the Free plan limit are frozen again.</>,
      confirmLabel: 'Revoke comp',
    } : {
      title: 'Grant complimentary Pro?',
      body: <>Give <b className="text-content">{email}</b> Pro free for <b className="text-content ui-tnum">{parsedDays} days</b>? It expires on its own and does not affect Stripe billing.</>,
      confirmLabel: `Comp for ${parsedDays} days`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.adminCompTenant(tenantId, comped ? 0 : parsedDays);
      toast({ tone: 'positive', title: comped ? `Revoked comp for ${email}` : `Comped ${email} for ${parsedDays} days` });
      onDone();
    } catch (e) {
      toast({ tone: 'negative', title: comped ? "Couldn't revoke the comp" : "Couldn't grant the comp", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
      {comped ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run()}>
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
          <Button variant="secondary" size="sm" disabled={!daysValid || busy} title={daysValid ? undefined : 'Between 1 and 3650 days'} onClick={() => void run()}>
            Comp
          </Button>
        </>
      )}
    </div>
  );
}
