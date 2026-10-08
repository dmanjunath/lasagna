import { useEffect, useRef, useState } from 'react';
import { Redirect, useLocation } from 'wouter';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button, Field, Input, Label, MoneyInput } from '../components/uikit';
import { PageTitle } from '../components/ds/PageTitle';
import { canGoBackInApp } from '../lib/in-app-history';
import { iconFor, toggleId, AccountPicker, goalAccent, GOAL_PRESETS, fetchFundableAccounts, type Account } from './goal-shared';
import {
  isTypedGoalCategory, emptyDraft, resolveDraft, useGoalFormContext,
  GoalDetailFields, GoalTargetReadout, NoSpendData, CalculateFromDetails, READOUT_ID, TODAY,
  plainFieldErrors, DECIMAL_2DP,
  type DetailDraft, type TypedGoalCategory,
} from './goal-details';

// ---------------------------------------------------------------------------
// Create-goal page — the form that used to be an inline expanding panel on
// /goals. Every create entry point on that page now links here instead.
// ---------------------------------------------------------------------------

export function NewGoal() {
  const [, setLocation] = useLocation();
  const [creating, setCreating] = useState(false);

  // A Suggested tile on /goals sends ?kind=<category> to preselect a kind.
  // Read it once, before first render, so the page never paints "General
  // Savings" and then jumps to the real kind a frame later.
  const [initialPreset] = useState(() =>
    GOAL_PRESETS.find((p) => p.category === new URLSearchParams(window.location.search).get('kind')),
  );

  // Create form state — seeded from the preselected kind exactly as
  // selectPreset would set it (name follows an untouched/default name,
  // target only when the preset suggests one).
  const [newName, setNewName] = useState(initialPreset?.name ?? '');
  const [newTarget, setNewTarget] = useState(initialPreset?.suggestedTarget ? String(initialPreset.suggestedTarget) : '');
  const [newMonthly, setNewMonthly] = useState('');
  const [newIcon, setNewIcon] = useState<string>(initialPreset?.icon ?? 'target');
  const [newDeadline, setNewDeadline] = useState('');
  const [newCategory, setNewCategory] = useState(initialPreset?.category ?? 'savings');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newAccountIds, setNewAccountIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  // One draft per typed kind, so switching home -> car -> home brings back what
  // was typed instead of an empty form.
  const [detailDrafts, setDetailDrafts] = useState<Partial<Record<TypedGoalCategory, DetailDraft>>>({});
  // Kinds the user chose to give a plain target to instead (emergency fund with
  // no spending history to price months against).
  const [plainTargetKinds, setPlainTargetKinds] = useState<string[]>([]);
  const createNameRef = useRef<HTMLInputElement>(null);

  // Birth date + the monthly-spend baseline. This page IS the create form, so
  // the context loads as soon as it mounts (no panel-open gate to wait on).
  const goalCtx = useGoalFormContext(true);

  // A typed category describes itself, so its target is computed rather than
  // typed. Falling back to a plain target is the user's own opt-out.
  const activeKind: TypedGoalCategory | null =
    isTypedGoalCategory(newCategory) && !plainTargetKinds.includes(newCategory) ? newCategory : null;
  const draft: DetailDraft | null = activeKind
    ? detailDrafts[activeKind] ?? emptyDraft(activeKind, goalCtx)
    : null;
  const resolved = activeKind && draft ? resolveDraft(activeKind, draft, goalCtx) : null;
  // The profile lands after the form can already be typed in, so a draft
  // started before it arrived would keep the defaults it was born with: an
  // empty retirement age, or Date mode on a goal that should offer Age. Only
  // fields the user has not filled are brought up to date.
  useEffect(() => {
    if (!goalCtx.loaded) return;
    setDetailDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(prev) as TypedGoalCategory[]) {
        const current = prev[key];
        if (!current) continue;
        const seed = emptyDraft(key, goalCtx);
        const patch: Partial<DetailDraft> = {};
        if (current.targetAge === '' && seed.targetAge !== '') patch.targetAge = seed.targetAge;
        if (current.byAge === '' && current.byDate === '' && current.dateMode !== seed.dateMode) {
          patch.dateMode = seed.dateMode;
        }
        if (Object.keys(patch).length > 0) {
          next[key] = { ...current, ...patch };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [goalCtx.loaded, goalCtx.retirementAge, goalCtx.dateOfBirth, goalCtx.currentAge]);

  const patchDraft = (patch: Partial<DetailDraft>) => {
    if (!activeKind) return;
    setDetailDrafts((prev) => ({
      ...prev,
      [activeKind]: { ...(prev[activeKind] ?? emptyDraft(activeKind, goalCtx)), ...patch },
    }));
  };

  // One completeness rule for the primary button and the Enter key, so Enter
  // can never create a goal the button would have refused.
  // The same rule the edit panel uses: these are text inputs, so "." and
  // "1.2.3" reach the API as null or a number nobody typed.
  const createErrors = plainFieldErrors({
    target: newTarget,
    deadline: newDeadline,
    monthly: newMonthly,
  });
  const canCreate =
    !!newName && !createErrors.monthly && (resolved ? resolved.details !== null : createErrors.ok);

  useEffect(() => {
    fetchFundableAccounts().then(setAccounts).catch(console.error);
  }, []);

  const selectPreset = (preset: typeof GOAL_PRESETS[0]) => {
    setNewIcon(preset.icon);
    setNewCategory(preset.category);
    // Presets are a starting point, not a reset — never clobber what the user
    // typed. A name still holding an earlier preset's text was never theirs,
    // so it follows the kind rather than going stale.
    const untouched = !newName.trim() || GOAL_PRESETS.some((q) => q.name === newName.trim());
    if (untouched) setNewName(preset.name);
    if (!newTarget && preset.suggestedTarget) setNewTarget(String(preset.suggestedTarget));
  };

  // On arrival: focus the name field.
  useEffect(() => {
    createNameRef.current?.focus({ preventScroll: true });
  }, []);

  const goBack = () => {
    // history.length counts entries from before the app, so it would send a
    // tab opened on this page back to wherever the link was.
    if (canGoBackInApp()) window.history.back();
    else setLocation('/goals');
  };

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setFormError(null);
    try {
      await api.createGoal({
        name: newName,
        // A typed goal's target and date come from the description, computed by
        // the same function the API stores target_amount with.
        targetAmount: resolved?.target ?? parseFloat(newTarget),
        details: resolved?.details ?? undefined,
        monthlyContribution: newMonthly ? parseFloat(newMonthly) : undefined,
        deadline: (resolved ? resolved.deadline : newDeadline) || undefined,
        category: newCategory,
        icon: newIcon,
        accountIds: newAccountIds,
      });
      setLocation('/goals');
    } catch (err) {
      console.error(err);
      setFormError('Could not create goal. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  if (isDemo) return <Redirect to="/goals" />;

  return (
    <div className="mx-auto max-w-[880px] px-3 sm:px-11 pt-4 md:pt-9 pb-6 sm:pb-28 text-content">
      <PageTitle className="sm:text-[36px]">New goal</PageTitle>
      <div
        className="cq-inline mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7"
        onKeyDown={(e) => {
          const t = e.target as HTMLInputElement;
          if (e.key === 'Escape') {
            // Same exception as Enter below: a search input owns its own
            // Escape (clearing the query), so it shouldn't also leave the page.
            if (t.tagName === 'INPUT' && t.type === 'search') return;
            goBack();
            return;
          }
          if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'search') {
            e.preventDefault();
            // Same rule as the button: a typed goal's target goes valid
            // before its date is set, so Enter must not outrun it.
            if (canCreate && !creating) handleCreate();
          }
        }}
      >
        {/* The kind comes first: it decides which fields the rest of the
            form shows, so choosing it is the first thing you do. */}
        <div className="mb-5">
          <Label id="goal-kind-label">What kind of goal is this?</Label>
          <div
            className="goals-presets"
            role="radiogroup"
            aria-labelledby="goal-kind-label"
            style={{ marginTop: 8 }}
            onKeyDown={(e) => {
              // The radio pattern: arrows move the choice and focus within the
              // group, Home and End jump to the ends. One Tab stop for the group.
              const n = GOAL_PRESETS.length;
              const at = Math.max(0, GOAL_PRESETS.findIndex((p) => p.category === newCategory));
              const next =
                e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n
                : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at - 1 + n) % n
                : e.key === 'Home' ? 0
                : e.key === 'End' ? n - 1
                : null;
              if (next === null) return;
              e.preventDefault();
              selectPreset(GOAL_PRESETS[next]);
              (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
            }}
          >
            {GOAL_PRESETS.map((preset, i) => {
              const active = newCategory === preset.category;
              const noneChecked = !GOAL_PRESETS.some((p) => p.category === newCategory);
              const color = goalAccent(preset.category);
              return (
                <button
                  key={preset.category}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active || (noneChecked && i === 0) ? 0 : -1}
                  onClick={() => selectPreset(preset)}
                  className="goals-preset"
                  style={{
                    borderColor: active ? color : 'var(--ui-line)',
                    color: active ? color : 'rgb(var(--ui-content-muted))',
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                  }}
                >
                  {iconFor(preset.icon, 14)}
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* A typed kind gets a fixed column count. auto-fit picks a track
            count from the widest field, and the full-width readout forces
            a row break, which together strand a lone field beside a void.
            A plain goal keeps the auto-fit grid it has always had. */}
        <div
          className={cn('grid gap-4 mb-5', activeKind && 'goal-fields-grid')}
          style={activeKind ? undefined : { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-goal-name">Goal name</Label>
            <div className="flex gap-2">
              <div
                aria-label="Icon"
                className="grid w-14 shrink-0 place-items-center rounded-ui-md border border-line-strong bg-canvas-sunken text-content-secondary"
              >
                {iconFor(newIcon, 20)}
              </div>
              <Input
                ref={createNameRef}
                id="new-goal-name"
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Emergency Fund"
              />
            </div>
          </div>
          {activeKind && draft && resolved && !resolved.spendUnavailable ? (
            <GoalDetailFields
              kind={activeKind}
              draft={draft}
              onChange={patchDraft}
              resolved={resolved}
              ctx={goalCtx}
            />
          ) : activeKind ? null : (
            <>
              <Field label="Target amount" error={newTarget === '' ? undefined : createErrors.target}>
                <MoneyInput
                  type="text"
                  inputMode="decimal"
                  invalid={newTarget !== '' && !!createErrors.target}
                  value={newTarget}
                  onChange={e => setNewTarget(DECIMAL_2DP(e.target.value))}
                  placeholder="25000"
                  className="ui-tnum"
                  leadingIcon={<span className="text-[13px]">$</span>}
                />
              </Field>
              <Field label="Target date (optional)" error={createErrors.deadline}>
                <Input
                  type="date"
                  min={TODAY}
                  invalid={!!createErrors.deadline}
                  value={newDeadline}
                  onChange={e => setNewDeadline(e.target.value)}
                />
              </Field>
            </>
          )}
          {resolved && (
            <div style={{ gridColumn: '1 / -1' }}>
              {resolved.spendUnavailable ? (
                <NoSpendData onSetPlainTarget={() => setPlainTargetKinds((p) => [...p, newCategory])} />
              ) : (
                <GoalTargetReadout resolved={resolved} onUseMonthlyPlan={(amt) => setNewMonthly(String(amt))} />
              )}
            </div>
          )}
          <Field label="Planned monthly contribution (optional)" error={createErrors.monthly}>
            <MoneyInput
              type="text"
              inputMode="decimal"
              invalid={!!createErrors.monthly}
              value={newMonthly}
              onChange={e => setNewMonthly(DECIMAL_2DP(e.target.value))}
              placeholder="500"
              className="ui-tnum"
              leadingIcon={<span className="text-[13px]">$</span>}
            />
          </Field>
        </div>

        {/* Dropping to a plain amount is reversible here, the same as it
            is on the goal's own page. */}
        {plainTargetKinds.includes(newCategory) && (
          <div className="mb-5">
            <CalculateFromDetails
              category={newCategory}
              onStart={() => setPlainTargetKinds((p) => p.filter((k) => k !== newCategory))}
            />
          </div>
        )}

        {/* Accounts — linking ≥1 makes the goal auto-track its balance */}
        {accounts.length > 0 && (
          <div className="mb-5">
            <Label>Accounts (optional)</Label>
            <p className="mt-1 mb-2 text-[12px] text-content-muted">
              Linked accounts auto-track this goal's progress.
            </p>
            <AccountPicker
              accounts={accounts}
              selected={newAccountIds}
              onToggle={(id) => setNewAccountIds(prev => toggleId(prev, id))}
            />
          </div>
        )}

        <div className="flex gap-2.5">
          <Button
            disabled={!canCreate || creating}
            loading={creating}
            onClick={handleCreate}
            aria-describedby={resolved && !resolved.spendUnavailable ? READOUT_ID : undefined}
          >
            {creating ? 'Creating…' : 'Create goal'}
          </Button>
          <Button variant="ghost" onClick={goBack}>Cancel</Button>
        </div>
        {formError && (
          <p className="mt-2.5 text-[12px] font-semibold text-negative" role="status" aria-live="polite">{formError}</p>
        )}
      </div>
    </div>
  );
}
