import { useEffect, useRef, useState } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Button, Field, Input, Label, MoneyInput } from '../components/uikit';
import { PageTitle } from '../components/ds/PageTitle';
import { HeaderTextAction } from '../components/layout/app-header';
import { canGoBackInApp } from '../lib/in-app-history';
import { useIsMobile } from '../lib/hooks/use-mobile';
import { useMobileHeader } from '../lib/mobile-header';
import { iconFor, toggleId, AccountPicker, goalAccent, GOAL_PRESETS, fetchFundableAccounts, type Account } from './goal-shared';
import {
  isTypedGoalCategory, emptyDraft, resolveDraft, useGoalFormContext,
  GoalDetailFields, GoalTargetReadout, NoSpendData, CalculateFromDetails, READOUT_ID, TODAY,
  plainFieldErrors, DECIMAL_2DP,
  type DetailDraft, type TypedGoalCategory,
} from './goal-details';

// ---------------------------------------------------------------------------
// Create-goal page, in two steps. Step 1 picks the kind (/goals/new), step 2
// is the form (/goals/new?kind=<category>). The step lives in the URL so the
// browser back button and the native swipe-back both return to step 1, and
// a Suggested tile on /goals lands straight in step 2.
// ---------------------------------------------------------------------------

const presetFor = (kind: string | null) => GOAL_PRESETS.find((p) => p.category === kind);

export function NewGoal() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const isMobile = useIsMobile();
  const [creating, setCreating] = useState(false);
  const urlPreset = presetFor(new URLSearchParams(search).get('kind'));
  const step: 'kind' | 'details' = urlPreset ? 'details' : 'kind';
  // True once step 2 was reached from step 1 in this visit, so going back is a
  // history pop. A deep link to step 2 has no step 1 entry behind it.
  const pushedDetails = useRef(false);
  const [accountsOpen, setAccountsOpen] = useState(false);

  // A Suggested tile on /goals sends ?kind=<category> to preselect a kind.
  // Read it once, before first render, so the page never paints "General
  // Savings" and then jumps to the real kind a frame later.
  const [initialPreset] = useState(() => presetFor(new URLSearchParams(window.location.search).get('kind')));

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

  // Browser forward (or any URL change) to a kind the form isn't on yet.
  useEffect(() => {
    if (urlPreset && urlPreset.category !== newCategory) selectPreset(urlPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPreset?.category]);

  // On reaching the form: focus the name field. Not on touch: iOS shows the
  // focus ring without a keyboard, and the name is already filled in.
  useEffect(() => {
    if (step === 'details' && !window.matchMedia('(pointer: coarse)').matches) {
      createNameRef.current?.focus({ preventScroll: true });
    }
  }, [step]);

  const chooseKind = (preset: typeof GOAL_PRESETS[0]) => {
    selectPreset(preset);
    pushedDetails.current = true;
    setLocation(`/goals/new?kind=${preset.category}`);
    window.scrollTo(0, 0);
  };

  const backToKinds = () => {
    if (pushedDetails.current) window.history.back();
    else setLocation('/goals/new', { replace: true });
    pushedDetails.current = false;
    window.scrollTo(0, 0);
  };

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

  // On a phone the verb lives in the top bar, the way a native form does.
  useMobileHeader(
    step === 'details'
      ? {
          onBack: backToKinds,
          actions: (
            <HeaderTextAction
              label={creating ? 'Creating…' : 'Create'}
              onClick={handleCreate}
              disabled={!canCreate || creating}
            />
          ),
        }
      : null,
  );

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  if (isDemo) return <Redirect to="/goals" />;

  const chosen = presetFor(newCategory);

  return (
    <div className="mx-auto max-w-[880px] px-3 sm:px-11 pt-4 md:pt-9 pb-6 sm:pb-28 text-content">
      <PageTitle className="sm:text-[36px]">New goal</PageTitle>
      {step === 'kind' ? (
        <>
          <h2 className="mt-1 md:mt-6 text-[18px] font-semibold text-content">What are you saving for?</h2>
          {/* A phone gets one grouped list, the native settings idiom. Wider
              screens get the same tiles as the Suggested row on /goals. */}
          <ul className="mt-3 md:mt-4 overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm divide-y divide-line sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none">
            {GOAL_PRESETS.map((preset) => {
              const color = goalAccent(preset.category);
              return (
                <li key={preset.category}>
                  <button
                    type="button"
                    onClick={() => chooseKind(preset)}
                    className="ui-focus group flex w-full items-center gap-3 px-3.5 py-2.5 text-left min-h-touch active:bg-canvas-sunken transition-[box-shadow,border-color,background-color] [@media(hover:hover)]:hover:bg-canvas-sunken/60 sm:rounded-ui-lg sm:border sm:border-line sm:bg-panel sm:p-3.5 sm:shadow-ui-sm [@media(hover:hover)]:sm:hover:bg-panel [@media(hover:hover)]:sm:hover:shadow-ui-md [@media(hover:hover)]:sm:hover:border-line-strong"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm"
                      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                    >
                      {iconFor(preset.icon, 18)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-content">{preset.name}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-content-muted transition-[transform,color] [@media(hover:hover)]:group-hover:translate-x-0.5 [@media(hover:hover)]:group-hover:text-brand" />
                  </button>
                </li>
              );
            })}
          </ul>
          {!isMobile && (
            <div className="mt-6">
              <Button variant="ghost" onClick={goBack}>Cancel</Button>
            </div>
          )}
        </>
      ) : (
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
        {/* The kind chosen in step 1. Tapping it goes back to change it. */}
        {chosen && (
          <button
            type="button"
            onClick={backToKinds}
            className="ui-focus group -mx-1 mb-5 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded-ui-md px-1 py-1 text-left"
          >
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm"
              style={{ background: `color-mix(in srgb, ${goalAccent(chosen.category)} 14%, transparent)`, color: goalAccent(chosen.category) }}
            >
              {iconFor(chosen.icon, 18)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-content">{chosen.name}</span>
            <span className="shrink-0 text-[13px] font-semibold text-content-muted transition-colors [@media(hover:hover)]:group-hover:text-brand">Change</span>
          </button>
        )}

        {/* A typed kind gets a fixed column count. auto-fit picks a track
            count from the widest field, and the full-width readout forces
            a row break, which together strand a lone field beside a void.
            A plain goal's four fields sit two by two. */}
        <div
          className={cn('grid gap-4 mb-5', activeKind ? 'goal-fields-grid' : 'sm:grid-cols-2')}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-goal-name">Goal name</Label>
            <Input
              ref={createNameRef}
              id="new-goal-name"
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Emergency Fund"
            />
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

        {/* Accounts, folded away: linking one makes the goal auto-track its
            balance, but most goals start without it. */}
        {accounts.length > 0 && (
          <div className={cn('rounded-ui-lg border border-line', !isMobile && 'mb-5')}>
            <button
              type="button"
              aria-expanded={accountsOpen}
              aria-controls="new-goal-accounts"
              onClick={() => setAccountsOpen((o) => !o)}
              className="ui-focus flex w-full items-center gap-3 rounded-ui-lg px-3.5 py-3 text-left min-h-touch active:bg-canvas-sunken [@media(hover:hover)]:hover:bg-canvas-sunken/60 transition-colors"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-content">Track with linked accounts</span>
                <span className="mt-0.5 block text-[12px] text-content-muted">Progress follows their balances.</span>
              </span>
              {!accountsOpen && newAccountIds.length > 0 && (
                <span className="shrink-0 text-[12.5px] font-semibold text-content-muted ui-tnum">
                  {newAccountIds.length} selected
                </span>
              )}
              <ChevronDown
                size={18}
                className={cn('shrink-0 text-content-muted transition-transform duration-200 ease-ui', !accountsOpen && '-rotate-90')}
              />
            </button>
            {accountsOpen && (
              <div id="new-goal-accounts" className="border-t border-line p-3.5">
                <AccountPicker
                  accounts={accounts}
                  selected={newAccountIds}
                  onToggle={(id) => setNewAccountIds(prev => toggleId(prev, id))}
                />
              </div>
            )}
          </div>
        )}

        {!isMobile && (
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
        )}
        {formError && (
          <p className="mt-2.5 text-[12px] font-semibold text-negative" role="status" aria-live="polite">{formError}</p>
        )}
      </div>
      )}
    </div>
  );
}
