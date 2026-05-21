import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Loader2, Sparkles, X, ChevronDown, ChevronUp, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, type QuickImportParseResult, type QuickImportAccount, type QuickImportGoal, type QuickImportProfile, type QuickImportCurrentProfile } from '../lib/api';

type Stage = 'input' | 'preview' | 'done';

const EXAMPLE_PLACEHOLDER = `e.g. I'm 43, married with 2 kids in CA. I have a brokerage with $1.8M, Roth IRA $725k, 401k $220k, and a watch collection worth $30k. Mortgage is $480k at 6.25%.`;

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  depository: 'Cash',
  investment: 'Investment',
  credit: 'Credit',
  loan: 'Loan',
  real_estate: 'Real Estate',
  alternative: 'Alternative',
};

const ACCOUNT_TYPE_EMOJI: Record<string, string> = {
  depository: '💵',
  investment: '📈',
  credit: '💳',
  loan: '🏦',
  real_estate: '🏡',
  alternative: '💎',
};

const SUBTYPE_PRETTY: Record<string, string> = {
  '401k': '401(k)',
  '403b': '403(b)',
  roth_ira: 'Roth IRA',
  ira: 'Traditional IRA',
  brokerage: 'Brokerage',
  hsa: 'HSA',
  checking: 'Checking',
  savings: 'Savings',
  primary: 'Primary Residence',
  rental: 'Rental Property',
  mortgage: 'Mortgage',
  auto: 'Auto Loan',
  student: 'Student Loan',
};

const PROFILE_FIELD_LABELS: Record<keyof QuickImportProfile, string> = {
  name: 'Name',
  dateOfBirth: 'Date of birth',
  annualIncome: 'Annual income',
  filingStatus: 'Filing status',
  stateOfResidence: 'State',
  employmentType: 'Employment',
  riskTolerance: 'Risk tolerance',
  retirementAge: 'Retirement age',
  employerMatch: 'Employer 401(k) match',
  dependentCount: 'Dependents',
  hasHDHP: 'HDHP health plan',
  isPSLFEligible: 'PSLF eligible',
};

const FILING_LABELS: Record<string, string> = {
  single: 'Single',
  married_joint: 'Married filing jointly',
  married_separate: 'Married filing separately',
  head_of_household: 'Head of household',
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  w2: 'W2 employee',
  self_employed: 'Self-employed',
  '1099': '1099 contractor',
  business_owner: 'Business owner',
};

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatProfileValue(field: keyof QuickImportProfile, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'annualIncome' || field === 'employerMatch') {
    if (field === 'employerMatch') return `${value}%`;
    return formatMoney(Number(value));
  }
  if (field === 'filingStatus' && typeof value === 'string') return FILING_LABELS[value] ?? value;
  if (field === 'employmentType' && typeof value === 'string') return EMPLOYMENT_LABELS[value] ?? value;
  if (field === 'riskTolerance' && typeof value === 'string')
    return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function QuickImport() {
  const [, navigate] = useLocation();
  const { setOnboardingStage } = useAuth();
  const [stage, setStage] = useState<Stage>('input');
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<QuickImportParseResult | null>(null);
  const [currentProfile, setCurrentProfile] = useState<QuickImportCurrentProfile | null>(null);

  // Editable state — built from result on parse, then mutated by user in preview
  const [accounts, setAccounts] = useState<QuickImportAccount[]>([]);
  const [goalsState, setGoalsState] = useState<QuickImportGoal[]>([]);
  const [profileEdits, setProfileEdits] = useState<QuickImportProfile>({});
  const [profileFieldsKept, setProfileFieldsKept] = useState<Record<string, boolean>>({});

  const [commitSummary, setCommitSummary] = useState<{
    accounts: { id: string; name: string }[];
    goals: { id: string; name: string }[];
    profileUpdated: boolean;
  } | null>(null);

  const fromQuery = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('from');
  }, []);
  const fromOnboarding = fromQuery === 'onboarding';

  const handleParse = async () => {
    setError(null);
    setParsing(true);
    try {
      const res = await api.quickImportParse(text);
      setResult(res.parseResult);
      setCurrentProfile(res.currentProfile);
      setAccounts(res.parseResult.accounts);
      setGoalsState(res.parseResult.goals);
      setProfileEdits(res.parseResult.profile ?? {});

      // Default: keep any field the LLM extracted, unless it conflicts with
      // an existing non-null value — there we leave it OFF so user opts in.
      // Exception: name defaults ON even on conflict. Overwriting a name is
      // low-risk (typo is trivially fixable), and if the user typed it in
      // the input they almost certainly want it applied.
      const kept: Record<string, boolean> = {};
      const proposed = res.parseResult.profile ?? {};
      for (const k of Object.keys(proposed)) {
        const v = (proposed as Record<string, unknown>)[k];
        if (v === null || v === undefined) continue;
        if (k === 'name') {
          kept[k] = true;
          continue;
        }
        const existing = res.currentProfile
          ? (res.currentProfile as unknown as Record<string, unknown>)[k]
          : null;
        kept[k] = existing === null || existing === undefined || existing === '';
      }
      setProfileFieldsKept(kept);

      setStage('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    setError(null);

    // Validate balances
    const missing = accounts.find((a) => a.balance === null || a.balance === undefined);
    if (missing) {
      setError(`"${missing.name}" needs a balance.`);
      return;
    }

    // Build profile payload — only keep fields the user toggled on
    const profileToSend: QuickImportProfile = {};
    for (const key of Object.keys(profileEdits) as (keyof QuickImportProfile)[]) {
      if (profileFieldsKept[key]) {
        (profileToSend as Record<string, unknown>)[key] = profileEdits[key];
      }
    }

    const payload: QuickImportParseResult = {
      profile: Object.keys(profileToSend).length > 0 ? profileToSend : null,
      accounts,
      goals: goalsState,
      unparsed: result?.unparsed ?? [],
    };

    setCommitting(true);
    try {
      const res = await api.quickImportCommit(payload);
      setCommitSummary({
        accounts: res.created.accounts,
        goals: res.created.goals,
        profileUpdated: res.profileUpdated,
      });

      // If this Quick Import ran inside the onboarding flow and the user
      // created at least one account, treat onboarding as done. Accounts are
      // the signal — without an account the rest of the app has nothing to
      // operate on, so we don't shortcut completion for profile-only imports.
      if (fromOnboarding && res.created.accounts.length > 0) {
        try {
          await api.updateOnboardingStage(null);
          setOnboardingStage(null);
        } catch (e) {
          // Non-fatal — the user can advance manually from the form.
          console.error('Failed to mark onboarding complete:', e);
        }
      }

      setStage('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setCommitting(false);
    }
  };

  const itemCount =
    accounts.length +
    goalsState.length +
    Object.values(profileFieldsKept).filter(Boolean).length;

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 40px)', maxWidth: 1200, margin: '0 auto' }}>
      {stage === 'input' && (
        <InputStage
          text={text}
          setText={setText}
          parsing={parsing}
          error={error}
          onParse={handleParse}
        />
      )}

      {stage === 'preview' && result && (
        <PreviewStage
          result={result}
          accounts={accounts}
          setAccounts={setAccounts}
          goalsState={goalsState}
          setGoalsState={setGoalsState}
          profileEdits={profileEdits}
          setProfileEdits={setProfileEdits}
          profileFieldsKept={profileFieldsKept}
          setProfileFieldsKept={setProfileFieldsKept}
          currentProfile={currentProfile}
          itemCount={itemCount}
          committing={committing}
          error={error}
          onCommit={handleCommit}
          onBack={() => {
            setStage('input');
            setError(null);
          }}
        />
      )}

      {stage === 'done' && commitSummary && (
        <DoneStage
          summary={commitSummary}
          fromOnboarding={fromOnboarding}
          onboardingCompleted={fromOnboarding && commitSummary.accounts.length > 0}
          onContinue={() => {
            if (fromOnboarding && commitSummary.accounts.length > 0) {
              // Onboarding just got marked complete — drop straight to the
              // dashboard rather than the form (which would redirect anyway).
              navigate('/');
            } else if (fromOnboarding) {
              navigate('/onboarding');
            } else {
              navigate('/accounts');
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Input stage ─────────────────────────────────────────────────────────────

function InputStage({
  text,
  setText,
  parsing,
  error,
  onParse,
}: {
  text: string;
  setText: (v: string) => void;
  parsing: boolean;
  error: string | null;
  onParse: () => void;
}) {
  const tooShort = text.trim().length < 20;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea to fit content. Layout effect avoids a flicker between
  // the initial paint at the default `rows` height and the resized height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  return (
    <div className="pb-28">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="w-4 h-4 text-accent" />
        <h1 className="font-serif text-lg font-medium">Describe your finances</h1>
      </div>
      <p className="text-xs text-text-secondary mb-3 leading-snug">
        Type a sentence or two. We&rsquo;ll show you what we found before saving anything.
      </p>

      <label htmlFor="qi-text" className="sr-only">
        Describe your finances
      </label>
      <textarea
        ref={textareaRef}
        id="qi-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE_PLACEHOLDER}
        rows={4}
        className="w-full bg-bg-elevated border border-rule rounded-2xl p-3 text-base text-text outline-none focus:border-accent transition-colors resize-none leading-snug overflow-hidden"
        autoFocus
      />

      <SuggestionChips text={text} />

      {error && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <StickyFooter>
        <button
          onClick={onParse}
          disabled={tooShort || parsing}
          className="w-full bg-accent text-white font-medium rounded-2xl py-3.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {parsing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Reading…
            </>
          ) : (
            'Review what we found'
          )}
        </button>
      </StickyFooter>
    </div>
  );
}

// ─── Preview stage ───────────────────────────────────────────────────────────

function PreviewStage({
  result,
  accounts,
  setAccounts,
  goalsState,
  setGoalsState,
  profileEdits,
  setProfileEdits,
  profileFieldsKept,
  setProfileFieldsKept,
  currentProfile,
  itemCount,
  committing,
  error,
  onCommit,
  onBack,
}: {
  result: QuickImportParseResult;
  accounts: QuickImportAccount[];
  setAccounts: (v: QuickImportAccount[]) => void;
  goalsState: QuickImportGoal[];
  setGoalsState: (v: QuickImportGoal[]) => void;
  profileEdits: QuickImportProfile;
  setProfileEdits: (v: QuickImportProfile) => void;
  profileFieldsKept: Record<string, boolean>;
  setProfileFieldsKept: (v: Record<string, boolean>) => void;
  currentProfile: QuickImportCurrentProfile | null;
  itemCount: number;
  committing: boolean;
  error: string | null;
  onCommit: () => void;
  onBack: () => void;
}) {
  const profileFields = Object.entries(profileEdits).filter(
    ([_, v]) => v !== null && v !== undefined && v !== '',
  ) as [keyof QuickImportProfile, unknown][];

  const nothingFound =
    accounts.length === 0 && goalsState.length === 0 && profileFields.length === 0;

  return (
    <div className="pb-36 space-y-5">
      <div>
        <h1 className="font-serif text-xl font-medium mb-1">Here&rsquo;s what we found</h1>
        <p className="text-sm text-text-secondary">
          Edit anything that&rsquo;s wrong. Untoggle to skip. Nothing&rsquo;s saved yet.
        </p>
      </div>

      {nothingFound && (
        <div className="p-4 rounded-2xl bg-bg-elevated border border-rule text-sm text-text-secondary">
          We couldn&rsquo;t find anything to import. Try being more specific — include
          balances and account types.
        </div>
      )}

      {profileFields.length > 0 && (
        <ProfileCard
          fields={profileFields}
          edits={profileEdits}
          setEdits={setProfileEdits}
          kept={profileFieldsKept}
          setKept={setProfileFieldsKept}
          currentProfile={currentProfile}
        />
      )}

      {accounts.length > 0 && (
        <div className="space-y-3">
          <SectionHeader title="Accounts" count={accounts.length} />
          {accounts.map((a, i) => (
            <AccountCard
              key={i}
              account={a}
              onChange={(updated) => {
                const next = [...accounts];
                next[i] = updated;
                setAccounts(next);
              }}
              onRemove={() => setAccounts(accounts.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}

      {goalsState.length > 0 && (
        <div className="space-y-3">
          <SectionHeader title="Goals" count={goalsState.length} />
          {goalsState.map((g, i) => (
            <GoalCard
              key={i}
              goal={g}
              onChange={(updated) => {
                const next = [...goalsState];
                next[i] = updated;
                setGoalsState(next);
              }}
              onRemove={() => setGoalsState(goalsState.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}

      {result.unparsed.length > 0 && (
        <div className="p-3 rounded-2xl bg-bg-elevated/50 border border-dashed border-rule text-xs text-text-muted">
          <div className="font-medium mb-1 text-text-secondary">We heard but didn&rsquo;t act on:</div>
          <ul className="space-y-0.5">
            {result.unparsed.map((u, i) => (
              <li key={i}>&ldquo;{u}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <StickyFooter>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="px-4 py-3.5 rounded-2xl border border-rule text-sm text-text-secondary hover:bg-bg-elevated"
            disabled={committing}
          >
            Edit text
          </button>
          <button
            onClick={onCommit}
            disabled={committing || itemCount === 0}
            className="flex-1 bg-accent text-white font-medium rounded-2xl py-3.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {committing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              `Create ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
            )}
          </button>
        </div>
      </StickyFooter>
    </div>
  );
}

// ─── Profile card ────────────────────────────────────────────────────────────

function ProfileCard({
  fields,
  edits,
  setEdits,
  kept,
  setKept,
  currentProfile,
}: {
  fields: [keyof QuickImportProfile, unknown][];
  edits: QuickImportProfile;
  setEdits: (v: QuickImportProfile) => void;
  kept: Record<string, boolean>;
  setKept: (v: Record<string, boolean>) => void;
  currentProfile: QuickImportCurrentProfile | null;
}) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Profile" count={fields.length} />
      <div className="bg-bg-elevated border border-rule rounded-2xl divide-y divide-rule overflow-hidden">
        {fields.map(([field, value]) => {
          const existing = currentProfile ? (currentProfile as unknown as Record<string, unknown>)[field] : null;
          const hasConflict =
            existing !== null && existing !== undefined && existing !== '' && existing !== value;
          const isKept = !!kept[field];

          return (
            <div key={field} className="px-4 py-3 flex items-start gap-3">
              <button
                onClick={() => setKept({ ...kept, [field]: !isKept })}
                className={`mt-1 w-5 h-5 rounded border shrink-0 grid place-items-center transition-colors ${
                  isKept ? 'bg-accent border-accent' : 'bg-transparent border-rule'
                }`}
                aria-label={isKept ? 'Skip this field' : 'Include this field'}
              >
                {isKept && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-muted mb-1">{PROFILE_FIELD_LABELS[field]}</div>
                <EditProfileField
                  field={field}
                  value={value}
                  onChange={(v) => setEdits({ ...edits, [field]: v })}
                />
                {hasConflict && (
                  <div className="text-[11px] text-amber-400/80 mt-1">
                    Currently set to{' '}
                    <span className="line-through">{formatProfileValue(field, existing)}</span>
                    {' '}— will overwrite
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const US_STATE_CODES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const inputCls =
  'w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent';

function EditProfileField({
  field,
  value,
  onChange,
}: {
  field: keyof QuickImportProfile;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  // Plain text
  if (field === 'name') {
    return (
      <input
        type="text"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder="Your name"
        className={inputCls}
      />
    );
  }

  // Numbers
  if (field === 'annualIncome') {
    return (
      <CurrencyInput
        value={value === null || value === undefined ? null : Number(value)}
        onChange={onChange}
      />
    );
  }
  if (field === 'employerMatch' || field === 'retirementAge' || field === 'dependentCount') {
    return (
      <input
        type="number"
        inputMode="decimal"
        step={field === 'employerMatch' ? '0.5' : '1'}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={inputCls}
      />
    );
  }

  // Date
  if (field === 'dateOfBirth') {
    const s = typeof value === 'string' && value ? value.slice(0, 10) : '';
    return (
      <input
        type="date"
        value={s}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${inputCls} [color-scheme:dark]`}
      />
    );
  }

  // State
  if (field === 'stateOfResidence') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${inputCls} appearance-none`}
      >
        <option value="">Select…</option>
        {US_STATE_CODES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  }

  // Enums
  if (field === 'filingStatus') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${inputCls} appearance-none`}
      >
        <option value="">Select…</option>
        <option value="single">Single</option>
        <option value="married_joint">Married filing jointly</option>
        <option value="married_separate">Married filing separately</option>
        <option value="head_of_household">Head of household</option>
      </select>
    );
  }
  if (field === 'employmentType') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${inputCls} appearance-none`}
      >
        <option value="">Select…</option>
        <option value="w2">W2 employee</option>
        <option value="self_employed">Self-employed</option>
        <option value="1099">1099 contractor</option>
        <option value="business_owner">Business owner</option>
      </select>
    );
  }
  if (field === 'riskTolerance') {
    return (
      <select
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={`${inputCls} appearance-none`}
      >
        <option value="">Select…</option>
        <option value="conservative">Conservative</option>
        <option value="moderate_conservative">Moderately Conservative</option>
        <option value="moderate">Moderate</option>
        <option value="moderate_aggressive">Moderately Aggressive</option>
        <option value="aggressive">Aggressive</option>
      </select>
    );
  }

  // Booleans
  if (field === 'hasHDHP' || field === 'isPSLFEligible') {
    const v = value === true;
    return (
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={v}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-accent w-4 h-4"
        />
        <span className="text-text-secondary">{v ? 'Yes' : 'No'}</span>
      </label>
    );
  }

  return null;
}

// ─── Account card ────────────────────────────────────────────────────────────

function AccountCard({
  account,
  onChange,
  onRemove,
}: {
  account: QuickImportAccount;
  onChange: (v: QuickImportAccount) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const missingBalance = account.balance === null || account.balance === undefined;
  const emoji = ACCOUNT_TYPE_EMOJI[account.type] ?? '💼';
  const subLabel = account.subtype
    ? SUBTYPE_PRETTY[account.subtype] ?? account.subtype
    : ACCOUNT_TYPE_LABELS[account.type];

  return (
    <div className={`bg-bg-elevated border rounded-2xl overflow-hidden ${
      missingBalance ? 'border-amber-500/40' : 'border-rule'
    }`}>
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-2xl leading-none">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{account.name}</div>
          <div className="text-xs text-text-muted truncate">{subLabel}</div>
        </div>
        <div className="text-right shrink-0">
          {missingBalance ? (
            <span className="text-xs text-amber-400">Balance needed</span>
          ) : (
            <span className="text-sm font-medium tabular-nums">{formatMoney(account.balance)}</span>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-8 h-8 grid place-items-center text-text-muted hover:text-text"
          aria-label={expanded ? 'Collapse' : 'Edit'}
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button
          onClick={onRemove}
          className="w-8 h-8 grid place-items-center text-text-muted hover:text-red-400"
          aria-label="Remove"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-rule">
          <Field label="Name">
            <input
              type="text"
              value={account.name}
              onChange={(e) => onChange({ ...account, name: e.target.value })}
              className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={account.type}
                onChange={(e) =>
                  onChange({ ...account, type: e.target.value as QuickImportAccount['type'] })
                }
                className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent appearance-none"
              >
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subtype">
              <input
                type="text"
                value={account.subtype ?? ''}
                onChange={(e) => onChange({ ...account, subtype: e.target.value || null })}
                placeholder="optional"
                className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>
          </div>
          <Field label="Balance">
            <CurrencyInput
              value={account.balance}
              onChange={(v) => onChange({ ...account, balance: v })}
            />
          </Field>
          {(account.type === 'loan' || account.type === 'credit') && (
            <Field label="APR (%)">
              <input
                type="number"
                step="0.01"
                value={account.apr ?? ''}
                onChange={(e) =>
                  onChange({ ...account, apr: e.target.value === '' ? null : Number(e.target.value) })
                }
                className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>
          )}
          {account.type === 'depository' && (
            <Field label="APY (%)">
              <input
                type="number"
                step="0.01"
                value={account.apy ?? ''}
                onChange={(e) =>
                  onChange({ ...account, apy: e.target.value === '' ? null : Number(e.target.value) })
                }
                className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </Field>
          )}
        </div>
      )}

      {!expanded && account.sourcePhrase && (
        <div className="px-4 pb-3 -mt-1 text-[11px] text-text-muted italic truncate">
          from: &ldquo;{account.sourcePhrase}&rdquo;
        </div>
      )}
    </div>
  );
}

// ─── Goal card ───────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  onChange,
  onRemove,
}: {
  goal: QuickImportGoal;
  onChange: (v: QuickImportGoal) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-bg-elevated border border-rule rounded-2xl overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-2xl leading-none">🎯</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{goal.name}</div>
          <div className="text-xs text-text-muted">
            {formatMoney(goal.targetAmount)}
            {goal.deadline ? ` by ${goal.deadline}` : ''}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-8 h-8 grid place-items-center text-text-muted hover:text-text"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <button
          onClick={onRemove}
          className="w-8 h-8 grid place-items-center text-text-muted hover:text-red-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-rule">
          <Field label="Name">
            <input
              type="text"
              value={goal.name}
              onChange={(e) => onChange({ ...goal, name: e.target.value })}
              className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </Field>
          <Field label="Target amount">
            <CurrencyInput
              value={goal.targetAmount}
              onChange={(v) => onChange({ ...goal, targetAmount: v ?? 0 })}
            />
          </Field>
          <Field label="Deadline (YYYY-MM-DD)">
            <input
              type="date"
              value={goal.deadline ?? ''}
              onChange={(e) => onChange({ ...goal, deadline: e.target.value || null })}
              className="w-full bg-bg border border-rule rounded-lg px-3 py-2 text-sm outline-none focus:border-accent [color-scheme:dark]"
            />
          </Field>
        </div>
      )}
      {!expanded && goal.sourcePhrase && (
        <div className="px-4 pb-3 -mt-1 text-[11px] text-text-muted italic truncate">
          from: &ldquo;{goal.sourcePhrase}&rdquo;
        </div>
      )}
    </div>
  );
}

// ─── Done stage ──────────────────────────────────────────────────────────────

function DoneStage({
  summary,
  fromOnboarding,
  onboardingCompleted,
  onContinue,
}: {
  summary: { accounts: { id: string; name: string }[]; goals: { id: string; name: string }[]; profileUpdated: boolean };
  fromOnboarding: boolean;
  onboardingCompleted: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="pb-32">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 grid place-items-center">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h1 className="font-serif text-xl font-medium">All set</h1>
          <p className="text-sm text-text-secondary">Your data has been imported.</p>
        </div>
      </div>

      <div className="space-y-3">
        {summary.accounts.length > 0 && (
          <div className="bg-bg-elevated border border-rule rounded-2xl p-4">
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
              Accounts created ({summary.accounts.length})
            </div>
            <ul className="text-sm space-y-1">
              {summary.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  {a.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.goals.length > 0 && (
          <div className="bg-bg-elevated border border-rule rounded-2xl p-4">
            <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
              Goals created ({summary.goals.length})
            </div>
            <ul className="text-sm space-y-1">
              {summary.goals.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  {g.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        {summary.profileUpdated && (
          <div className="bg-bg-elevated border border-rule rounded-2xl p-4 text-sm flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            Profile updated
          </div>
        )}
      </div>

      <StickyFooter>
        <button
          onClick={onContinue}
          className="w-full bg-accent text-white font-medium rounded-2xl py-3.5"
        >
          {onboardingCompleted
            ? 'Go to dashboard'
            : fromOnboarding
              ? 'Continue setup'
              : 'View accounts'}
        </button>
      </StickyFooter>
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between px-1">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-secondary">{title}</h2>
      <span className="text-xs text-text-muted">{count}</span>
    </div>
  );
}

// ─── Suggestion chips ────────────────────────────────────────────────────────
// Client-side keyword detection. Zero LLM cost — re-runs on every keystroke.
// A chip strikes through when ANY matcher fires for the category.

interface SuggestionCategory {
  key: string;
  label: string;
  patterns: RegExp[];
}

const US_STATE_NAMES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia',
  'hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland',
  'massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey',
  'new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina',
  'south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming',
];

const SUGGESTIONS: SuggestionCategory[] = [
  {
    key: 'name',
    label: 'Name',
    patterns: [
      // Accept any word after "I'm/i'm" so lowercase names ("i'm jonas") match.
      // False positives like "i'm tired" are acceptable for a hint chip.
      /\b[Ii]['’]?m\s+[A-Za-z]{2,}\b/,
      /\b(my name is|call me)\s+[A-Za-z]{2,}\b/i,
    ],
  },
  {
    key: 'age',
    label: 'Age',
    patterns: [/\b\d{1,2}\s*(years?\s*old|yo|y\/o)\b/i, /\bage\s*\d{1,2}\b/i, /\bborn\s+(19|20)\d{2}\b/i],
  },
  {
    key: 'state',
    label: 'State',
    patterns: [
      /\b(in|live in|reside in|from)\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
      new RegExp(`\\b(in|live in|reside in|from)\\s+(${US_STATE_NAMES.join('|')})\\b`, 'i'),
    ],
  },
  {
    key: 'filing',
    label: 'Filing status',
    patterns: [/\b(married|single|head of household|filing)\b/i],
  },
  {
    key: 'dependents',
    label: 'Dependents',
    patterns: [
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(kids?|child(ren)?|dependents?)\b/i,
      /\bno\s+(kids|children|dependents)\b/i,
    ],
  },
  {
    key: 'income',
    label: 'Income',
    patterns: [
      /\b(salary|income|paycheck)\b/i,
      /\b(make|earn|making|earning)\s+\$?\d/i,
      /\$\d+\s*k\b.*(salary|income|year|yr|annual)/i,
    ],
  },
  {
    key: 'retirement',
    label: 'Retirement accounts',
    patterns: [/\b(401\s*k|403\s*b|ira|roth|sep|hsa|tsp)\b/i],
  },
  {
    key: 'investments',
    label: 'Brokerage',
    patterns: [/\b(brokerage|stocks?|equities|etf|mutual fund|crypto|bitcoin|index fund|taxable account)\b/i],
  },
  {
    key: 'cash',
    label: 'Cash',
    patterns: [/\b(checking|savings|cd|money market|emergency fund|cash)\b/i],
  },
  {
    key: 'property',
    label: 'Property',
    patterns: [/\b(home|house|property|residence|rental|condo|townhome|real estate)\b/i],
  },
  {
    key: 'debts',
    label: 'Debts',
    patterns: [
      /\bmortg\w*\b/i,                            // tolerate typos like "mortage"
      /\b(loans?|debt|car notes?|auto note)\b/i,
    ],
  },
  {
    key: 'credit_cards',
    label: 'Credit cards',
    patterns: [
      /\bcredit\s*cards?\b/i,
      /\bcc\s+(debt|balance|bill)\b/i,
      /\b(visa|mastercard|master\s*card|amex|american\s*express|discover|chase\s*sapphire)\b/i,
    ],
  },
];

function SuggestionChips({ text }: { text: string }) {
  const matched = useMemo(() => {
    if (!text.trim()) return new Set<string>();
    const set = new Set<string>();
    for (const cat of SUGGESTIONS) {
      if (cat.patterns.some((re) => re.test(text))) set.add(cat.key);
    }
    return set;
  }, [text]);

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1.5">
        Things to mention
      </div>
      <div className="flex flex-wrap gap-1">
        {SUGGESTIONS.map((cat) => {
          const hit = matched.has(cat.key);
          return (
            <span
              key={cat.key}
              className={`inline-flex items-center gap-0.5 text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                hit
                  ? 'border-accent/30 bg-accent/5 text-text-muted line-through opacity-60'
                  : 'border-rule bg-bg-elevated text-text-secondary'
              }`}
            >
              {hit && <Check className="w-2.5 h-2.5 text-accent shrink-0 no-underline" />}
              {cat.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

function CurrencyInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));

  // Keep local text in sync if parent resets the number (e.g., after re-parse).
  useEffect(() => {
    setText(value === null || value === undefined ? '' : String(value));
  }, [value]);

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const clean = e.target.value.replace(/[^0-9.]/g, '');
          setText(clean);
          onChange(clean === '' ? null : Number(clean));
        }}
        placeholder="0"
        className="w-full bg-bg border border-rule rounded-lg pl-7 pr-3 py-2 text-sm outline-none focus:border-accent"
      />
    </div>
  );
}

function StickyFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 max-w-md mx-auto bg-bg/95 backdrop-blur border-t border-rule/60 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
      {children}
    </div>
  );
}
