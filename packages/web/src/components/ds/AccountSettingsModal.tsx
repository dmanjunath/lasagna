import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * Per-account settings: reclassify type/subtype, rename (manual only), and the
 * three balance overrides (exclude from net worth / exclude transactions /
 * invert). Saves via PATCH /accounts/:id, plus the manual-account endpoint for
 * the name. Reuses the .ds-confirm backdrop so it matches the other modals, and
 * manages focus (trap + Escape + focus-in) so keyboard/AT users aren't stranded.
 */

export interface AccountSettingsAccount {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  isManual: boolean;
  balance: number;
  excludeFromNetWorth?: boolean;
  excludeTransactions?: boolean;
  invertBalance?: boolean;
}

interface TypeOption {
  label: string;
  type: string;
  subtype: string | null;
}

// Mirrors the manual-account creation list on /accounts, with Checking and
// Savings split so saving never collapses a synced subtype into one bucket.
const TYPE_OPTIONS: TypeOption[] = [
  { label: 'Checking', type: 'depository', subtype: 'checking' },
  { label: 'Savings', type: 'depository', subtype: 'savings' },
  { label: '401(k) / 403(b)', type: 'investment', subtype: '401k' },
  { label: 'Roth IRA', type: 'investment', subtype: 'roth_ira' },
  { label: 'Traditional IRA', type: 'investment', subtype: 'ira' },
  { label: 'Brokerage', type: 'investment', subtype: 'brokerage' },
  { label: 'HSA', type: 'investment', subtype: 'hsa' },
  { label: 'Primary Residence', type: 'real_estate', subtype: 'primary' },
  { label: 'Rental Property', type: 'real_estate', subtype: 'rental' },
  { label: 'Other Asset', type: 'alternative', subtype: null },
  { label: 'Credit Card', type: 'credit', subtype: null },
  { label: 'Student Loan', type: 'loan', subtype: 'student' },
  { label: 'Auto Loan', type: 'loan', subtype: 'auto' },
  { label: 'Mortgage', type: 'loan', subtype: 'mortgage' },
];

const LIABILITY_TYPES = new Set(['credit', 'loan']);
const keyFor = (type: string, subtype: string | null) => `${type}:${subtype ?? ''}`;
const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function AccountSettingsModal({
  account,
  onClose,
  onSaved,
}: {
  account: AccountSettingsAccount;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const initialKey = keyFor(account.type, account.subtype);
  const knownKeys = new Set(TYPE_OPTIONS.map((o) => keyFor(o.type, o.subtype)));
  // If the synced type/subtype isn't one of our presets, keep it as an option
  // so saving doesn't silently reclassify it.
  const options: TypeOption[] = knownKeys.has(initialKey)
    ? TYPE_OPTIONS
    : [{ label: titleCaseType(account.type, account.subtype), type: account.type, subtype: account.subtype }, ...TYPE_OPTIONS];

  const [name, setName] = useState(account.name);
  const [typeKey, setTypeKey] = useState(initialKey);
  const [excludeFromNetWorth, setExcludeNW] = useState(Boolean(account.excludeFromNetWorth));
  const [excludeTransactions, setExcludeTx] = useState(Boolean(account.excludeTransactions));
  const [invertBalance, setInvert] = useState(Boolean(account.invertBalance));
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus management: pull focus into the dialog, trap Tab, close on Escape.
  useEffect(() => {
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const f = node.querySelectorAll<HTMLElement>(
        'input, select, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = options.find((o) => keyFor(o.type, o.subtype) === typeKey)!;
  const wasLiability = LIABILITY_TYPES.has(account.type);
  const willBeLiability = LIABILITY_TYPES.has(chosen.type);
  // Reclassifying across the asset/liability line flips this account's sign in
  // net worth — warn before it happens (delete confirms; this should too).
  const crossesBucket = wasLiability !== willBeLiability;
  const displayedBalance = invertBalance ? -account.balance : account.balance;

  const save = async () => {
    setSaving(true);
    try {
      if (account.isManual && name.trim() && name.trim() !== account.name) {
        await api.updateManualAccount(account.id, { name: name.trim() });
      }
      await api.updateAccount(account.id, {
        type: chosen.type,
        subtype: chosen.subtype,
        excludeFromNetWorth,
        excludeTransactions,
        invertBalance,
      });
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="ds-confirm__backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ds-confirm" role="dialog" aria-modal="true" aria-label="Account settings" ref={dialogRef} style={{ maxWidth: 460, padding: 24 }}>
        <h3 className="ds-confirm__title">Account settings</h3>
        <p className="ds-caption" style={{ marginTop: -4, marginBottom: 16, color: 'var(--lf-muted)' }}>
          {titleCase(account.name)}
        </p>

        {account.isManual ? (
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </Field>
        ) : (
          <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, background: 'var(--lf-cream-deep)', color: 'var(--lf-muted)' }}>
            <span style={{ color: 'var(--lf-ink)' }}>{titleCase(account.name)}</span>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Synced · read-only</span>
          </div>
        )}

        <Field label="Account type">
          <div style={{ position: 'relative' }}>
            <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)} style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 36, cursor: 'pointer' }}>
              {options.map((o) => (
                <option key={keyFor(o.type, o.subtype)} value={keyFor(o.type, o.subtype)}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--lf-muted)', pointerEvents: 'none' }} />
          </div>
          {crossesBucket && (
            <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.4, color: 'var(--lf-neg)' }}>
              This moves the account {willBeLiability ? 'into debt' : 'into assets'} — it will change your net worth.
            </p>
          )}
        </Field>

        <div style={{ height: 1, background: 'var(--lf-rule)', margin: '16px 0' }} />

        <Toggle
          checked={excludeFromNetWorth}
          onChange={setExcludeNW}
          label="Exclude from net worth"
          description={`Keep the account visible but leave its ${fmtUsd(Math.abs(displayedBalance))} out of net-worth totals and the chart.`}
        />
        <Toggle
          checked={excludeTransactions}
          onChange={setExcludeTx}
          label="Exclude transactions"
          description="Hide this account's transactions from spending and activity views."
        />
        <Toggle
          checked={invertBalance}
          onChange={setInvert}
          label="Invert balance"
          description={`Flip the sign of the balance. Currently counts as ${fmtUsd(displayedBalance)}${invertBalance ? ` (was ${fmtUsd(account.balance)})` : ''}.`}
        />

        <div className="ds-confirm__actions" style={{ marginTop: 20 }}>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--lf-ink-soft)', marginBottom: 6, letterSpacing: '0.02em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: '100%',
        padding: '12px 0',
        background: 'none',
        border: 0,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)' }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--lf-muted)', marginTop: 2, lineHeight: 1.4 }}>{description}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? 'var(--lf-sauce)' : 'var(--lf-rule)',
          position: 'relative',
          transition: 'background 0.15s ease',
          marginTop: 2,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: 'var(--lf-paper)',
            transition: 'left 0.15s ease',
            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          }}
        />
      </span>
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--lf-cream)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 8,
  fontSize: 15,
  color: 'var(--lf-ink)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

// Matches the dashboard's titleCase (short words like "CPC"/"529" stay caps).
function titleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function titleCaseType(type: string, subtype: string | null): string {
  const base = subtype || type;
  return base.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
