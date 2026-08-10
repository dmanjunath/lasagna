import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type CategoryRule, type CategoryRuleInput } from '../../lib/api';
import { Button, Field, Input, Modal, Select, Skeleton } from '../uikit';
import { useConfirm } from '../ds';
import { categoryOptionLabel, usePickerGroups, useTaxonomy } from '../../lib/taxonomy';

// ---------------------------------------------------------------------------
// RulesPanel — manage category rules from /spending. A single modal that swaps
// between a list of existing rules (as readable sentences) and a create/edit
// form, with an "apply to N existing?" confirm step after each save.
// ---------------------------------------------------------------------------

type AccountOption = { accountId: string; name: string };

type View =
  | { mode: 'list' }
  | { mode: 'form'; rule: CategoryRule | null }
  | { mode: 'confirm'; ruleId: string; count: number };

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
function ruleSentence(
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
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  seed: { merchantText: string; category: string } | null;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const pickerGroups = usePickerGroups();
  const { byId } = useTaxonomy();
  // Label a category reference by its taxonomy id.
  const labelFor = (id: string | null): string =>
    (id ? byId.get(id)?.name : undefined) ?? 'Unknown';
  const [view, setView] = useState<View>({ mode: 'list' });
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const loadRules = () => {
    setLoadingRules(true);
    api.getRules()
      .then((data) => setRules(data.rules))
      .catch(() => setRules([]))
      .finally(() => setLoadingRules(false));
  };

  // On open: fetch rules + accounts, and jump straight to the form when seeded.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSavedNote(false);
    if (seed) {
      setForm({ ...EMPTY_FORM, merchantContains: seed.merchantText, setCategory: seed.category });
      setView({ mode: 'form', rule: null });
    } else {
      setView({ mode: 'list' });
    }
    loadRules();
    api.getBalances()
      .then((data) => setAccounts(data.balances.map((b) => ({ accountId: b.accountId, name: b.name }))))
      .catch(() => setAccounts([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openForm = (rule: CategoryRule | null) => {
    setForm(rule ? formFromRule(rule) : EMPTY_FORM);
    setError(null);
    setSavedNote(false);
    setView({ mode: 'form', rule });
  };

  const backToList = () => {
    setError(null);
    setView({ mode: 'list' });
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      body: 'Existing categories stay as they are.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteRule(id);
      loadRules();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const handleSave = async () => {
    const clientError = validateForm(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    if (view.mode !== 'form') return;
    setSaving(true);
    setError(null);
    let savedRule: CategoryRule | null = null;
    try {
      const body = bodyFromForm(form);
      // PATCH is replace semantics — always send the complete rule body.
      const { rule } = view.rule
        ? await api.updateRule(view.rule.id, body)
        : await api.createRule(body);
      savedRule = rule;
      loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
      return;
    }
    // Rule saved — preview failure is non-fatal (rule already exists; re-save would duplicate).
    try {
      const { count } = await api.previewRule(savedRule.id);
      if (count > 0) {
        setView({ mode: 'confirm', ruleId: savedRule.id, count });
      } else {
        setSavedNote(true);
        setView({ mode: 'list' });
      }
    } catch {
      setSavedNote(true);
      setView({ mode: 'list' });
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    if (view.mode !== 'confirm') return;
    setSaving(true);
    try {
      await api.applyRule(view.ruleId);
      onChanged();
      backToList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // ── Views ────────────────────────────────────────────────────────────────

  const listBody = (
    <div>
      {savedNote && (
        <p className="mb-4 rounded-ui-md bg-brand-softer px-3.5 py-2.5 text-[13px] font-medium text-[rgb(var(--ui-brand-ink))]">
          Saved — will apply to new transactions.
        </p>
      )}
      {error && <p className="mb-4 text-[12.5px] font-medium text-negative">{error}</p>}
      {loadingRules ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-ui-md" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="py-2 text-center">
          <p className="text-[13.5px] text-content-muted">
            No rules yet. Create one to always file a merchant the way you want — e.g.
            anything containing &ldquo;AMZN&rdquo; as Shopping.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" leadingIcon={<Plus size={14} />} onClick={() => openForm(null)}>
            New rule
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-content">
                {ruleSentence(rule, accounts, labelFor)}{' '}
                <span className="text-content-muted">&rarr;</span>{' '}
                <b className="font-semibold">{labelFor(rule.setCategoryId)}</b>
              </p>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 min-h-0 min-w-0 shrink-0"
                aria-label="Edit rule"
                onClick={() => openForm(rule)}
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 min-h-0 min-w-0 shrink-0 text-negative hover:text-negative"
                aria-label="Delete rule"
                onClick={() => void handleDelete(rule.id)}
              >
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

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
          <Select
            value={form.amountMode}
            onChange={(e) => set({ amountMode: e.target.value as FormState['amountMode'] })}
            className="sm:w-[132px]"
            aria-label="Amount condition"
          >
            <option value="any">Any</option>
            <option value="equals">Exactly</option>
            <option value="between">Between</option>
          </Select>
          {form.amountMode === 'equals' && (
            <Input
              type="number"
              inputMode="decimal"
              value={form.amountEquals}
              onChange={(e) => set({ amountEquals: e.target.value })}
              placeholder="0.00"
              aria-label="Amount"
              className="ui-tnum"
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
                className="ui-tnum"
              />
              <Input
                type="number"
                inputMode="decimal"
                value={form.amountMax}
                onChange={(e) => set({ amountMax: e.target.value })}
                placeholder="Max"
                aria-label="Maximum amount"
                className="ui-tnum"
              />
            </>
          )}
        </div>
      </Field>
      <Field label="Account">
        <Select value={form.accountId} onChange={(e) => set({ accountId: e.target.value })}>
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>{a.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Current category">
        <Select value={form.matchCategory} onChange={(e) => set({ matchCategory: e.target.value })}>
          <option value="">Any</option>
          {pickerGroups.map(({ group, categories }) => (
            <optgroup key={group.id} label={group.name}>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      <Field label="Set category" required>
        <Select value={form.setCategory} onChange={(e) => set({ setCategory: e.target.value })}>
          <option value="" disabled>Choose a category…</option>
          {pickerGroups.map(({ group, categories }) => (
            <optgroup key={group.id} label={group.name}>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{categoryOptionLabel(cat)}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>
      {error && <p className="text-[12.5px] font-medium text-negative">{error}</p>}
    </div>
  );

  const footer =
    view.mode === 'form' ? (
      <>
        <Button variant="secondary" size="sm" onClick={backToList} disabled={saving}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void handleSave()} loading={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </>
    ) : view.mode === 'confirm' ? (
      <>
        <span className="mr-auto text-[13px] font-medium text-content-secondary">
          Apply to {view.count} existing transaction{view.count === 1 ? '' : 's'}?
        </span>
        <Button variant="secondary" size="sm" onClick={backToList} disabled={saving}>Skip</Button>
        <Button variant="primary" size="sm" onClick={() => void handleApply()} loading={saving}>
          {saving ? 'Applying…' : 'Apply'}
        </Button>
      </>
    ) : !loadingRules && rules.length > 0 ? (
      <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => openForm(null)}>
        New rule
      </Button>
    ) : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Category rules"
      description={view.mode === 'form'
        ? (view.rule ? 'Edit this rule.' : 'Transactions matching every condition get the new category.')
        : 'Rules re-categorize matching transactions automatically — new ones as they arrive.'}
      footer={footer}
    >
      {view.mode === 'form' ? formBody : view.mode === 'confirm' ? (
        <div className="space-y-3">
          <p className="text-[13.5px] leading-relaxed text-content-secondary">
            Rule saved. It will apply to new transactions automatically — you can also apply it to
            matching transactions you already have.
          </p>
          {error && <p className="text-[12.5px] font-medium text-negative">{error}</p>}
        </div>
      ) : listBody}
    </Modal>
  );
}
