import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '../uikit';
import { categoryOptionLabel, useCategoryDisplay, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// TransactionDetail — modal opened by clicking a transaction row. Merchant,
// category, and notes are editable; amount/date/account/original description
// are read-only. Save PATCHes only the changed fields.
// ---------------------------------------------------------------------------

export interface DetailTx {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  categoryId: string;
  date: string;
  notes?: string | null;
  excludedAt?: string | null;
  accountName?: string | null;
  pending?: number;
}

function formatCurrencyExact(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function longDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function TransactionDetail({ open, tx, onClose, onSaved }: {
  open: boolean;
  tx: DetailTx | null;
  onClose: () => void;
  onSaved: (patch: { merchantName?: string; categoryId?: string; notes?: string; excluded?: boolean }) => void;
}) {
  const [merchant, setMerchant] = useState('');
  // Holds the category ID (uuid) — the server dual-accepts it in `category`.
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [excluded, setExcluded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickerGroups = usePickerGroups();
  const { byId } = useTaxonomy();
  const displayOf = useCategoryDisplay();

  useEffect(() => {
    if (!open || !tx) return;
    setMerchant(tx.merchantName || tx.name);
    setCategory(tx.categoryId ?? '');
    setNotes(tx.notes ?? '');
    setExcluded(tx.excludedAt != null);
    setError(null);
    setSaving(false);
  }, [open, tx]);

  const handleSave = async () => {
    if (!tx) return;
    const body: { merchantName?: string; category?: string; notes?: string; excluded?: boolean } = {};
    if (merchant.trim() !== (tx.merchantName || tx.name)) body.merchantName = merchant.trim();
    if (category !== (tx.categoryId ?? '')) body.category = category;
    if (notes !== (tx.notes ?? '')) body.notes = notes;
    if (excluded !== (tx.excludedAt != null)) body.excluded = excluded;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateTransaction(tx.id, body);
      onSaved({
        ...(body.merchantName !== undefined ? { merchantName: body.merchantName } : {}),
        ...(body.category !== undefined ? { categoryId: body.category } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.excluded !== undefined ? { excluded: body.excluded } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const amount = tx ? parseFloat(tx.amount) : 0;
  const isIncome = amount < 0;

  return (
    <Modal
      open={open && tx !== null}
      onClose={onClose}
      title="Transaction details"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {tx && (
        <div className="space-y-5">
          {/* Read-only stack */}
          <div>
            <div className="flex items-center gap-2.5">
              <span className={cn('font-editorial text-[28px] font-extrabold tracking-[-0.02em] ui-tnum', isIncome && 'text-positive')}>
                {isIncome ? '+' : ''}{formatCurrencyExact(Math.abs(amount))}
              </span>
              {tx.pending === 1 && <Badge tone="neutral">Pending</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1 text-[13px] text-content-muted">
              <span className="ui-tnum">{longDate(tx.date)}</span>
              {tx.accountName && (
                <>
                  <span className="text-content-faint">·</span>
                  <span>{tx.accountName}</span>
                </>
              )}
            </div>
            <div className="mt-1.5 text-[12px] text-content-muted">
              Original description: <span className="text-content-secondary">{tx.name}</span>
            </div>
          </div>

          {/* Editable fields */}
          <Field label="Merchant">
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={255}
              placeholder="Merchant name"
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {!(category && byId.get(category) && !byId.get(category)!.disabled) && (
                <option value={category} disabled>
                  {category ? byId.get(category)?.name ?? displayOf(tx).label : displayOf(tx).label}
                </option>
              )}
              {pickerGroups.map(({ group, categories }) => (
                <optgroup key={group.id} label={group.name}>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="Add a note…"
            />
          </Field>
          <ExcludeToggle checked={excluded} onChange={setExcluded} />
          {error && <p className="text-[12.5px] font-medium text-negative">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

// Mirrors the house Toggle pattern (see account-detail's Toggle).
function ExcludeToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Exclude from spending"
      onClick={() => onChange(!checked)}
      className="ui-focus flex w-full items-start gap-3 border-t border-line py-3.5 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-content">Exclude from spending</span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-content-muted">
          Excluded transactions don&rsquo;t count toward spending, income, or charts.
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-150 ease-ui',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-panel shadow-ui-sm transition-[left] duration-150 ease-ui"
          style={{ left: checked ? 18 : 2 }}
        />
      </span>
    </button>
  );
}
