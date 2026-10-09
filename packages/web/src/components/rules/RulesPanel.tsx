import { useEffect, useState } from 'react';
import { api, type CategoryRule, type CategoryRuleInput, type RulePreviewTxn } from '../../lib/api';
import { Button, Field, HiddenAmount, Input, Modal, useToast } from '../uikit';
import { useLocation } from 'wouter';
import { cn, formatStoredDay } from '../../lib/utils';
import { isAmountsHidden } from '../../lib/hide-amounts';
import { useTaxonomy } from '../../lib/taxonomy';
import { CategoryPicker } from '../common/CategoryPicker';
import { OptionMenu } from '../common/OptionMenu';
import { AccountPicker } from '../common/AccountPicker';
import { useAccountsIndex } from '../../lib/use-accounts-index';

// Amount inputs carry no stepper arrows, as on the transactions filters.
const AMOUNT_INPUT = 'ui-tnum [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

// ---------------------------------------------------------------------------
// RulesPanel — the create/edit dialog for one category rule, then an "apply to
// existing?" step that lists the matching transactions so any can be left out.
// The list of rules lives in Settings (RulesManager, /profile#rules).
// ---------------------------------------------------------------------------

export type AccountOption = { accountId: string; name: string };

type View =
  | { mode: 'form' }
  | { mode: 'confirm'; ruleId: string; count: number; txns: RulePreviewTxn[]; wasEdit: boolean };

// matchCategory/setCategory hold category IDS (uuids) — the API field names
// are historical.
interface FormState {
  merchantContains: string;
  amountMode: 'any' | 'equals' | 'between';
  amountEquals: string;
  amountMin: string;
  amountMax: string;
  accountId: string;
  matchCategory: string;
  setCategory: string;
}

const EMPTY_FORM: FormState = {
  merchantContains: '',
  amountMode: 'any',
  amountEquals: '',
  amountMin: '',
  amountMax: '',
  accountId: '',
  matchCategory: '',
  setCategory: '',
};

function formFromRule(rule: CategoryRule): FormState {
  return {
    merchantContains: rule.merchantContains ?? '',
    amountMode: rule.amountEquals ? 'equals' : rule.amountMin || rule.amountMax ? 'between' : 'any',
    amountEquals: rule.amountEquals ?? '',
    amountMin: rule.amountMin ?? '',
    amountMax: rule.amountMax ?? '',
    accountId: rule.accountId ?? '',
    matchCategory: rule.matchCategoryId ?? '',
    setCategory: rule.setCategoryId,
  };
}

function bodyFromForm(f: FormState): CategoryRuleInput {
  return {
    merchantContains: f.merchantContains.trim() || null,
    amountEquals: f.amountMode === 'equals' ? f.amountEquals.trim() || null : null,
    amountMin: f.amountMode === 'between' ? f.amountMin.trim() || null : null,
    amountMax: f.amountMode === 'between' ? f.amountMax.trim() || null : null,
    accountId: f.accountId || null,
    matchCategory: f.matchCategory || null,
    setCategory: f.setCategory,
  };
}

// Mirrors the API's validateRule so most errors surface before the request.
function validateForm(f: FormState): string | null {
  const body = bodyFromForm(f);
  if (!body.setCategory) return 'Choose a category to set.';
  if (!body.merchantContains && !body.amountEquals && !body.amountMin && !body.amountMax && !body.accountId && !body.matchCategory) {
    return 'Add at least one condition.';
  }
  for (const [label, v] of [['Amount', body.amountEquals], ['Minimum amount', body.amountMin], ['Maximum amount', body.amountMax]] as const) {
    if (v && !Number.isFinite(Number(v))) return `${label} must be a number.`;
  }
  if (body.amountMin && body.amountMax && parseFloat(body.amountMin) > parseFloat(body.amountMax)) {
    return 'Minimum amount must be less than or equal to maximum.';
  }
  return null;
}

function fmtAmount(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// "If merchant contains 'amzn' and amount is between $10 and $50 on Chase Checking"
export function ruleSentence(
  rule: CategoryRule,
  accounts: AccountOption[],
  labelFor: (id: string | null) => string,
): string {
  const parts: string[] = [];
  if (rule.merchantContains) parts.push(`merchant contains “${rule.merchantContains}”`);
  if (rule.amountEquals) parts.push(`amount is exactly ${fmtAmount(rule.amountEquals)}`);
  else if (rule.amountMin && rule.amountMax) parts.push(`amount is between ${fmtAmount(rule.amountMin)} and ${fmtAmount(rule.amountMax)}`);
  else if (rule.amountMin) parts.push(`amount is at least ${fmtAmount(rule.amountMin)}`);
  else if (rule.amountMax) parts.push(`amount is at most ${fmtAmount(rule.amountMax)}`);
  if (rule.matchCategoryId) {
    parts.push(`currently categorized as ${labelFor(rule.matchCategoryId)}`);
  }
  if (rule.accountId) {
    const name = accounts.find((a) => a.accountId === rule.accountId)?.name ?? 'a specific account';
    if (parts.length === 0) return `If the account is ${name}`;
    return `If ${parts.join(' and ')} on ${name}`;
  }
  return `If ${parts.join(' and ')}`;
}

export function RulesPanel({
  open,
  onClose,
  seed,
  rule,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** New rule prefilled from a recategorize (merchant + target category). */
  seed: { merchantText: string; category: string } | null;
  /** Edit this rule instead of creating one. */
  rule?: CategoryRule | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [location, navigate] = useLocation();
  const { list: accountIndex } = useAccountsIndex();
  const { byId } = useTaxonomy();
  const labelFor = (id: string) => byId.get(id)?.name ?? 'Other';
  const [view, setView] = useState<View>({ mode: 'form' });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Transactions the user unticked in the apply step.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setExcluded(new Set());
    setView({ mode: 'form' });
    setForm(rule ? formFromRule(rule) : seed ? { ...EMPTY_FORM, merchantContains: seed.merchantText, setCategory: seed.category } : EMPTY_FORM);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Saved: the dialog closes and a toast confirms it, with a way to the rules
  // list unless that list is the page already on screen.
  const finish = (wasEdit: boolean) => {
    onChanged();
    onClose();
    const onSettings = location === '/profile';
    let dismiss = () => {};
    dismiss = toast({
      tone: 'positive',
      title: wasEdit ? 'Rule saved' : 'Rule created',
      duration: 6000,
      description: onSettings ? undefined : (
        <button
          type="button"
          onClick={() => { dismiss(); navigate('/profile#rules'); }}
          className="ui-focus mt-0.5 rounded-ui-sm font-semibold text-[rgb(var(--ui-brand-ink))] hover:underline"
        >
          View rules
        </button>
      ),
    });
  };

  const handleSave = async () => {
    const clientError = validateForm(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    setSaving(true);
    setError(null);
    let savedRule: CategoryRule | null = null;
    try {
      const body = bodyFromForm(form);
      // PATCH is replace semantics — always send the complete rule body.
      const res = rule ? await api.updateRule(rule.id, body) : await api.createRule(body);
      savedRule = res.rule;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
      return;
    }
    // Rule saved — preview failure is non-fatal (rule already exists; re-save would duplicate).
    try {
      const { count, transactions } = await api.previewRule(savedRule.id);
      if (count > 0) setView({ mode: 'confirm', ruleId: savedRule.id, count, txns: transactions, wasEdit: !!rule });
      else finish(!!rule);
    } catch {
      finish(!!rule);
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    if (view.mode !== 'confirm') return;
    setSaving(true);
    try {
      await api.applyRule(view.ruleId, [...excluded]);
      finish(view.wasEdit);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const formBody = (
    <div className="space-y-4">
      <Field label="Merchant contains">
        <Input
          value={form.merchantContains}
          onChange={(e) => set({ merchantContains: e.target.value })}
          placeholder="e.g. amzn"
        />
      </Field>
      <Field label="Amount">
        <div className="flex flex-col gap-2 sm:flex-row">
          <OptionMenu
            portal
            ariaLabel="Amount condition"
            value={form.amountMode}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'equals', label: 'Exactly' },
              { value: 'between', label: 'Between' },
            ]}
            onChange={(amountMode) => set({ amountMode })}
            className="shrink-0 sm:w-[132px]"
          />
          {form.amountMode === 'equals' && (
            <Input
              type="number"
              inputMode="decimal"
              value={form.amountEquals}
              onChange={(e) => set({ amountEquals: e.target.value })}
              placeholder="0.00"
              aria-label="Amount"
              className={AMOUNT_INPUT}
            />
          )}
          {form.amountMode === 'between' && (
            <>
              <Input
                type="number"
                inputMode="decimal"
                value={form.amountMin}
                onChange={(e) => set({ amountMin: e.target.value })}
                placeholder="Min"
                aria-label="Minimum amount"
                className={AMOUNT_INPUT}
              />
              <Input
                type="number"
                inputMode="decimal"
                value={form.amountMax}
                onChange={(e) => set({ amountMax: e.target.value })}
                placeholder="Max"
                aria-label="Maximum amount"
                className={AMOUNT_INPUT}
              />
            </>
          )}
        </div>
      </Field>
      <Field label="Account">
        {/* The same account dropdown as the transactions filter, one pick. */}
        <AccountPicker
          portal
          accounts={accountIndex}
          value={form.accountId}
          onChange={(accountId) => set({ accountId })}
        />
      </Field>
      <Field label="Current category">
        {/* "Any" is a row in the list, as Account's is. */}
        <CategoryPicker
          variant="field"
          value={form.matchCategory}
          currentLabel="Any category"
          anyLabel="Any category"
          showManage={false}
          onChange={(matchCategory) => set({ matchCategory })}
        />
      </Field>
      <Field label="Set category" required>
        <CategoryPicker
          variant="field"
          value={form.setCategory}
          currentLabel="Choose a category"
          showManage={false}
          onChange={(setCategory) => set({ setCategory })}
        />
      </Field>
      {error && <p className="text-[12.5px] font-medium text-negative">{error}</p>}
    </div>
  );

  const applyCount = view.mode === 'confirm' ? view.count - excluded.size : 0;
  const confirmBody = view.mode === 'confirm' && (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed text-content-secondary">
        It also matches {view.count} transaction{view.count === 1 ? '' : 's'} you already have. Untick any to keep their current category.
      </p>
      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-ui-md border border-line">
        {view.txns.map((t) => {
          const on = !excluded.has(t.id);
          const amount = Math.abs(parseFloat(t.amount));
          return (
            <li key={t.id}>
              <label className="flex min-h-touch cursor-pointer items-center gap-3 px-3 py-2 hover:bg-canvas-sunken">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  })}
                  aria-label={`Apply to ${t.merchantName || t.name}, ${formatStoredDay(t.date)}`}
                  className="h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--ui-brand))]"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[13.5px] font-semibold', on ? 'text-content' : 'text-content-muted line-through')}>
                    {t.merchantName || t.name}
                  </span>
                  <span className="block truncate text-[12px] text-content-muted">
                    {/* The category an untick keeps. */}
                    {formatStoredDay(t.date, { year: 'numeric' })}{t.accountName ? `, ${t.accountName}` : ''}, {labelFor(t.categoryId)}
                  </span>
                </span>
                <span className="ui-tnum shrink-0 text-[13.5px] font-semibold text-content">
                  {isAmountsHidden() ? <HiddenAmount /> : `${parseFloat(t.amount) < 0 ? '+' : ''}$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {view.count > view.txns.length && (
        <p className="text-[12px] text-content-muted">Showing the newest {view.txns.length}. The rest are included.</p>
      )}
      {error && <p className="text-[12.5px] font-medium text-negative">{error}</p>}
    </div>
  );

  const footer =
    view.mode === 'form' ? (
      <>
        <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" size="sm" onClick={() => finish(view.wasEdit)} disabled={saving}>Skip</Button>
        <Button variant="primary" size="sm" onClick={() => void handleApply()} loading={saving} disabled={applyCount === 0}>
          {saving ? 'Applying…' : `Apply to ${applyCount}`}
        </Button>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={view.mode === 'confirm' ? 'Apply to existing transactions?' : rule ? 'Edit rule' : 'New rule'}
      description={view.mode === 'form' ? 'Transactions matching every condition get the new category.' : undefined}
      footer={footer}
    >
      {view.mode === 'form' ? formBody : confirmBody}
    </Modal>
  );
}
