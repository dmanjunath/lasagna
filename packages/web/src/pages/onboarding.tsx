import { useState, useCallback, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  Loader2,
  Link2,
  Sparkles,
  LogOut,
  Mail,
  UserPlus,
} from 'lucide-react';
import { BrandMark } from '../components/common/BrandMark';
import { Button, Surface, Field, Input, Label, MoneyInput, Select } from '../components/uikit';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatMoney } from '../lib/utils';

const STEP_TO_STAGE = ['profile', 'income', 'lifestyle', 'complete'] as const;

// ─── US States ────────────────────────────────────────────
// Full names are what the user scans; the two-letter code is the stored value.
const US_STATES: Array<{ code: string; name: string }> = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The stored values are unchanged. Only the wording is: each option now names
// what a bad year does to the money and what the user gets for putting up with
// it, instead of naming an investor posture.
const RISK_LEVELS = [
  { value: 'conservative', label: 'Almost no drop, and the slowest growth', summary: 'Very low' },
  { value: 'moderate_conservative', label: 'A small drop, and slow growth', summary: 'Low' },
  { value: 'moderate', label: 'A real drop, and moderate growth', summary: 'Medium' },
  { value: 'moderate_aggressive', label: 'A big drop, and fast growth', summary: 'High' },
  { value: 'aggressive', label: 'A very big drop, and the fastest growth', summary: 'Very high' },
];

const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married_joint', label: 'Married, filing jointly' },
  { value: 'married_separate', label: 'Married, filing separately' },
  { value: 'head_of_household', label: 'Head of household' },
];

// Yes / No / I'm not sure. "I'm not sure" is a real answer that is stored as an
// unknown, never as a No — an unanswered health plan used to reach the plan as
// "not enrolled" and an unanswered match as "your employer matches 0 percent".
type Tri = 'yes' | 'no' | 'unsure' | '';
const TRI_OPTIONS: Array<{ value: Tri; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: "I'm not sure" },
];

// Yes and No are short; "I'm not sure" is not, and an even third wraps it.
const TRI_GRID = 'grid-cols-[1fr_1fr_1.4fr]';

const triToBool = (v: Tri): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);
const boolToTri = (v: boolean | null | undefined): Tri => (v === true ? 'yes' : v === false ? 'no' : '');

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -300 : 300, opacity: 0 }),
};

// ─── Shared Bright class recipes ─────────────────────────
const chipBase =
  'flex items-center justify-between gap-2 w-full min-h-[48px] px-4 py-3 rounded-ui-md border text-sm text-left transition-[background-color,border-color,color] duration-150 ease-ui';
const chipInactive =
  'border-line-strong bg-panel text-content-secondary hover:bg-canvas-sunken hover:border-line-heavy';
const chipActive =
  'border-brand bg-brand-soft text-[rgb(var(--ui-brand-ink))]';

function CurrencyInput({ value, onChange, placeholder = '0', autoFocus }: {
  value: string; onChange: (val: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <MoneyInput
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="ui-tnum"
      leadingIcon={<span className="text-[13px]">$</span>}
    />
  );
}

/** A labelled group of chip choices — Field's shape, for controls that aren't one input. */
function ChoiceField({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <Label id={`${id}-label`}>{label}</Label>
      <div role="group" aria-labelledby={`${id}-label`} className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-[12px] text-content-muted">{hint}</p>}
    </div>
  );
}

function Chips<T extends string>({ options, value, onChange, className, align = 'start' }: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
  align?: 'start' | 'center';
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'ui-focus',
              chipBase,
              align === 'center' ? 'justify-center' : 'justify-start',
              active ? chipActive : chipInactive,
            )}
          >
            <span className="font-semibold">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Date of birth as month / day / year. A native date input makes someone born
 * in 1965 scrub a calendar back sixty years; three lists land in two taps. The
 * `id` and `aria-describedby` Field hands down go to the month list, so the
 * "Date of birth" label and its hint still name the control.
 */
function DateOfBirthFields({ id, value, onChange, 'aria-describedby': describedBy }: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  'aria-describedby'?: string;
}) {
  // The three lists hold their own answers. A half-filled date is not a date,
  // so the parent only ever sees '' or a whole one, and picking a month first
  // must not be thrown away while the year is still empty.
  const split = (iso: string) => {
    const [y = '', m = '', d = ''] = iso ? iso.split('-') : [];
    return { y, m, d };
  };
  const [parts, setParts] = useState(() => split(value));
  const { y: year, m: month, d: day } = parts;

  useEffect(() => {
    if (value) setParts(split(value));
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: 88 }, (_, i) => String(thisYear - 13 - i)),
    [thisYear],
  );
  // 2000 is a leap year, so an unset year never hides February 29th.
  const daysInMonth = month ? new Date(Number(year || 2000), Number(month), 0).getDate() : 31;

  const emit = (m: string, d: string, y: string) => {
    // A short month drops a day that no longer exists rather than storing Feb 31.
    const max = m ? new Date(Number(y || 2000), Number(m), 0).getDate() : 31;
    const safeDay = d && Number(d) > max ? '' : d;
    setParts({ y, m, d: safeDay });
    onChange(m && safeDay && y ? `${y}-${m}-${safeDay}` : '');
  };

  const faint = 'text-content-faint';
  return (
    <div className="grid grid-cols-[1.35fr_0.8fr_0.85fr] gap-2">
      <Select
        id={id}
        aria-describedby={describedBy}
        value={month}
        onChange={(e) => emit(e.target.value, day, year)}
        compact
        className={cn(!month && faint)}
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>
        ))}
      </Select>
      <Select
        aria-label="Day"
        value={day}
        onChange={(e) => emit(month, e.target.value, year)}
        compact
        className={cn(!day && faint)}
      >
        <option value="">Day</option>
        {Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
          <option key={d} value={d}>{Number(d)}</option>
        ))}
      </Select>
      <Select
        aria-label="Year"
        value={year}
        onChange={(e) => emit(month, day, e.target.value)}
        compact
        className={cn('ui-tnum', !year && faint)}
      >
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>
    </div>
  );
}

/**
 * State of residence as a type-ahead over full state names. Fifty two-letter
 * codes are a database value, not a list anyone can scan. Stores the code.
 */
function StatePicker({ id, value, onChange, 'aria-describedby': describedBy }: {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  'aria-describedby'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = US_STATES.find((s) => s.code === value) ?? null;
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q === ''
        ? US_STATES
        : US_STATES.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q),
    [q],
  );

  const openList = () => {
    if (open) return;
    setQuery('');
    setActive(Math.max(0, US_STATES.findIndex((s) => s.code === value)));
    setOpen(true);
  };
  const close = () => { setOpen(false); setQuery(''); };
  const pick = (code: string) => { onChange(code); close(); };

  useEffect(() => { setActive(0); }, [q]);

  // The field is the last one on the step, so left where it is the list would
  // open straight into the pinned footer. Bring the field up first, and only
  // flip the list upward if that still is not enough room.
  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    let rect = el.getBoundingClientRect();
    if (window.innerHeight - rect.bottom < 280) {
      el.scrollIntoView({ block: 'center' });
      rect = el.getBoundingClientRect();
    }
    setDropUp(window.innerHeight - rect.bottom < 280 && rect.top > 240);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { openList(); return; }
      if (matches.length === 0) return;
      const next = e.key === 'ArrowDown' ? active + 1 : active - 1;
      setActive((next + matches.length) % matches.length);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (matches[active]) pick(matches[active].code);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].code}` : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        className="pr-10"
        placeholder="Start typing a state"
        value={open ? query : selected?.name ?? ''}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
        onClick={openList}
        onKeyDown={onKeyDown}
      />
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-[22px] h-4 w-4 -translate-y-1/2 text-content-muted"
        aria-hidden
      />
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className={cn(
            'absolute left-0 right-0 z-30 max-h-[240px] overflow-y-auto rounded-ui-md border border-line-strong bg-panel p-1 shadow-ui-lg',
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-content-muted">No state matches that.</p>
          ) : (
            matches.map((s, i) => (
              <button
                key={s.code}
                id={`${listId}-${s.code}`}
                type="button"
                role="option"
                aria-selected={s.code === value}
                data-active={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s.code)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-ui-sm px-3 py-2 text-left text-sm transition-colors duration-100',
                  'hover:bg-canvas-sunken hover:text-content',
                  i === active ? 'bg-canvas-sunken text-content' : 'text-content-secondary',
                )}
              >
                <span>{s.name}</span>
                {s.code === value && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const STAGE_TO_STEP: Record<string, number> = {
  // 'accounts' is a legacy stage (the dedicated connect step was removed) —
  // map it to the final "You're all set" screen (step 3).
  profile: 0, income: 1, lifestyle: 2, accounts: 3, complete: 3,
};

export function Onboarding() {
  const [, navigate] = useLocation();
  const { user, setOnboardingStage, logout } = useAuth();
  const isOwner = user?.role === "owner";
  const [initializing, setInitializing] = useState(true);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [filingStatus, setFilingStatus] = useState('');
  const [stateOfResidence, setStateOfResidence] = useState('');

  // Step 1 — Income & goals
  const [annualIncome, setAnnualIncome] = useState('');
  const [matchAnswer, setMatchAnswer] = useState<Tri>('');
  const [matchPercent, setMatchPercent] = useState('');
  // Defaulted, so the step is never blocked by a question with no default. It
  // is the middle option, and anyone who cares will change it.
  const [riskTolerance, setRiskTolerance] = useState('moderate');
  const [retirementAge, setRetirementAge] = useState('65');

  // Step 2 — Life situation
  const [employmentType, setEmploymentType] = useState('w2');
  const [dependentCount, setDependentCount] = useState<number | null>(null);
  const [hdhp, setHdhp] = useState<Tri>('');
  const [pslf, setPslf] = useState<Tri>('');

  const [linkedViaPlaid, setLinkedViaPlaid] = useState(false);

  const matchPercentId = useId();

  // ─── Restore from DB on mount ───────────────────────────
  useEffect(() => {
    Promise.all([
      api.me(),
      api.getProfile().catch(() => null),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getItems().catch(() => ({ items: [] })),
    ]).then(([meData, profileData, fpData, itemData]) => {
      const fp = fpData?.financialProfile;

      // Restore form fields from existing data
      if (profileData?.profile?.name) setName(profileData.profile.name);
      if (fp) {
        if (fp.dateOfBirth) setDob(fp.dateOfBirth.split('T')[0]);
        if (fp.filingStatus) setFilingStatus(fp.filingStatus);
        if (fp.stateOfResidence) setStateOfResidence(fp.stateOfResidence);
        if (fp.annualIncome) setAnnualIncome(String(fp.annualIncome));
        if (fp.riskTolerance) setRiskTolerance(fp.riskTolerance);
        if (fp.retirementAge) setRetirementAge(String(fp.retirementAge));
        // 0 is "there is no match"; a number is the match; null is still unknown.
        if (fp.employerMatchPercent === 0) {
          setMatchAnswer('no');
        } else if (fp.employerMatchPercent !== null && fp.employerMatchPercent !== undefined) {
          setMatchAnswer('yes');
          setMatchPercent(String(fp.employerMatchPercent));
        }
        if (fp.employmentType) setEmploymentType(fp.employmentType);
        if (fp.dependentCount !== null && fp.dependentCount !== undefined) setDependentCount(fp.dependentCount);
        setHdhp(boolToTri(fp.hasHDHP));
        setPslf(boolToTri(fp.isPSLFEligible));
      }

      const hasPlaid = itemData.items.some((i: { institutionId: string | null }) => i.institutionId && i.institutionId !== 'manual');
      if (hasPlaid) setLinkedViaPlaid(true);

      // Use server-side stage as source of truth
      const serverStage = meData.user.onboardingStage;
      const startStep = serverStage ? (STAGE_TO_STEP[serverStage] ?? 0) : 0;
      setStep(startStep);
    }).finally(() => setInitializing(false));
  }, []);

  const totalSteps = 4;

  // One rule for every step, stated out loud: a starred field blocks, and the
  // footer says which one. Step 1 used to wave everyone through while step 2
  // silently refused, and neither explained itself.
  const blockedReason =
    step === 0 && !name.trim() ? 'Add your name to continue.'
    : step === 1 && !annualIncome.trim() ? 'Add your income to continue.'
    : null;

  const goNext = useCallback(async () => {
    setSaving(true);
    try {
      if (step === 0) {
        await api.updateProfile({ name: name.trim() });
        await api.updateFinancialProfile({
          dateOfBirth: dob || null,
          // "I'm not sure" and "not answered" are both stored as unknown, which
          // is what the rest of the app already reads null as.
          filingStatus: filingStatus && filingStatus !== 'unsure' ? filingStatus : null,
          stateOfResidence: stateOfResidence || null,
        });
      } else if (step === 1) {
        await api.updateFinancialProfile({
          annualIncome: annualIncome ? parseFloat(annualIncome) : null,
          // 0 only when the user SAID there is no match. Silence stays null.
          employerMatchPercent:
            matchAnswer === 'no' ? 0
            : matchAnswer === 'yes' && matchPercent.trim() ? parseFloat(matchPercent)
            : null,
          riskTolerance,
          retirementAge: retirementAge ? parseInt(retirementAge) : 65,
        });
      } else if (step === 2) {
        await api.updateFinancialProfile({
          employmentType,
          dependentCount,
          hasHDHP: triToBool(hdhp),
          isPSLFEligible: triToBool(pslf),
        });
      }
    } catch (err) {
      console.error('Failed to save onboarding step:', err);
    } finally {
      setSaving(false);
    }
    const nextStep = Math.min(step + 1, totalSteps - 1);
    const nextStage = STEP_TO_STAGE[nextStep] ?? null;
    await api.updateOnboardingStage(nextStage).catch(() => {});
    setDirection(1);
    setStep(nextStep);
  }, [step, name, dob, filingStatus, stateOfResidence, annualIncome, matchAnswer, matchPercent, riskTolerance, retirementAge, employmentType, dependentCount, hdhp, pslf]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Mark onboarding complete (server + local state) so the guarded app opens.
  const finishOnboarding = async () => {
    await api.updateOnboardingStage(null).catch(() => {});
    setOnboardingStage(null);
  };

  // Primary completion action: finish onboarding, then hand off to the real
  // accounts page which auto-opens Plaid Link on ?autoLink=true.
  const handleConnectAccounts = async () => {
    await finishOnboarding();
    navigate('/accounts?autoLink=true');
  };

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="font-editorial text-[26px] sm:text-[30px] font-medium leading-[1.05] tracking-[-0.015em] text-content">
                Let&apos;s get to know you
              </h2>
              <p className="text-[15px] leading-relaxed text-content-secondary">
                A few basics about you. Everything else is worked out from these.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/quick-import?from=onboarding')}
              className="ui-focus block w-full text-left rounded-ui-lg border border-brand-soft bg-brand-softer p-4 transition-[border-color,box-shadow] duration-150 ease-ui hover:border-brand hover:shadow-ui-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                <span className="text-sm font-semibold text-brand">
                  Quick Import: describe yourself instead
                </span>
              </div>
              <div className="text-[13px] text-content-muted">
                Type a sentence or two and we&apos;ll fill out your profile and accounts.
              </div>
            </button>

            <div className="flex flex-col gap-5">
              <Field label="Your name" required>
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Alex" autoFocus />
              </Field>

              <Field label="Date of birth"
                hint="So we can work out how long your money needs to last.">
                <DateOfBirthFields value={dob} onChange={setDob} />
              </Field>

              <Field label="Filing status"
                hint="Tax rules differ by filing status, and it changes what you can save tax-free.">
                <Select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}
                  className={cn(!filingStatus && 'text-content-faint')}>
                  <option value="">Select one</option>
                  {FILING_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  <option value="unsure">I&apos;m not sure</option>
                </Select>
              </Field>

              <Field label="State of residence"
                hint="Some states tax what you earn and some do not, which changes what you take home.">
                <StatePicker value={stateOfResidence} onChange={setStateOfResidence} />
              </Field>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="font-editorial text-[26px] sm:text-[30px] font-medium leading-[1.05] tracking-[-0.015em] text-content">
                Your income &amp; goals
              </h2>
              <p className="text-[15px] leading-relaxed text-content-secondary">
                What you earn, how much of it you keep, and when you want to stop working.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <Field label="Annual income before tax" required
                hint="So we can tell you how much of what you earn is actually being saved.">
                <CurrencyInput value={annualIncome} onChange={setAnnualIncome} placeholder="75000" />
              </Field>

              <ChoiceField label="Does your employer add money when you save for retirement?">
                <Chips options={TRI_OPTIONS} value={matchAnswer} onChange={setMatchAnswer}
                  className={TRI_GRID} align="center" />
              </ChoiceField>

              {matchAnswer === 'yes' && (
                <div className="space-y-1.5">
                  <Label htmlFor={matchPercentId}>How much of your pay do they add?</Label>
                  <div className="relative">
                    <Input id={matchPercentId} type="text" inputMode="decimal"
                      aria-describedby={`${matchPercentId}-desc`}
                      value={matchPercent}
                      onChange={(e) => setMatchPercent(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="3" className="ui-tnum pr-9" />
                    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted text-sm">%</span>
                  </div>
                  <p id={`${matchPercentId}-desc`} className="text-[12px] text-content-muted">
                    Leave this blank if you do not know it.
                  </p>
                </div>
              )}

              <ChoiceField label="In a bad year, how much of a drop could you live with?">
                <Chips options={RISK_LEVELS} value={riskTolerance} onChange={setRiskTolerance} />
              </ChoiceField>

              <Field label="Target retirement age"
                hint="We will check whether what you save now gets you there.">
                <Input type="text" inputMode="numeric" maxLength={2} value={retirementAge}
                  onChange={(e) => setRetirementAge(e.target.value.replace(/[^0-9]/g, ''))}
                  className="ui-tnum" />
              </Field>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="font-editorial text-[26px] sm:text-[30px] font-medium leading-[1.05] tracking-[-0.015em] text-content">
                Your situation
              </h2>
              <p className="text-[15px] leading-relaxed text-content-secondary">
                A few things that change which accounts and benefits you can use.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <ChoiceField
                label="What kind of work do you do?"
                hint="Working for yourself opens retirement accounts an employee cannot use."
              >
                <Chips
                  className="grid-cols-2"
                  value={employmentType}
                  onChange={setEmploymentType}
                  options={[
                    { value: 'w2', label: 'Employee' },
                    { value: 'self_employed', label: 'Self-employed' },
                    { value: '1099', label: 'Contractor' },
                    { value: 'business_owner', label: 'Business owner' },
                  ]}
                />
              </ChoiceField>

              <ChoiceField
                label="How many people depend on your income?"
                hint="People who depend on you change what is worth insuring and saving for."
              >
                <div className="flex items-center gap-2">
                  {[0, 1, 2, 3, 4].map(n => {
                    const active = dependentCount === n;
                    return (
                      <button key={n} type="button" aria-pressed={active}
                        aria-label={n === 4 ? '4 or more' : String(n)}
                        onClick={() => setDependentCount(n)}
                        className={cn(
                          'ui-focus h-12 w-12 rounded-ui-md border font-semibold text-[15px] ui-tnum transition-[background-color,border-color,color] duration-150 ease-ui',
                          active ? chipActive : chipInactive,
                        )}>
                        {n === 4 ? '4+' : n}
                      </button>
                    );
                  })}
                </div>
              </ChoiceField>

              <ChoiceField
                label="Does your health plan have a high deductible?"
                hint="A high deductible means you pay more yourself before the plan starts paying. If yours does, you can use a savings account that is never taxed."
              >
                <Chips options={TRI_OPTIONS} value={hdhp} onChange={setHdhp}
                  className={TRI_GRID} align="center" />
              </ChoiceField>

              <ChoiceField
                label="Do you work for the government or a non-profit?"
                hint="Government and non-profit workers can have student loans forgiven after 10 years of payments."
              >
                <Chips options={TRI_OPTIONS} value={pslf} onChange={setPslf}
                  className={TRI_GRID} align="center" />
              </ChoiceField>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="flex flex-col items-center gap-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand"
            >
              <Check className="h-8 w-8" />
            </motion.div>

            <div className="flex flex-col gap-2 text-center">
              <h2 className="font-editorial text-[26px] sm:text-[30px] font-medium leading-[1.05] tracking-[-0.015em] text-content">
                You&apos;re all set!
              </h2>
              <p className="mx-auto max-w-sm text-[15px] leading-relaxed text-content-secondary">
                Your dashboard is ready. We&apos;ll use this information to personalize your projections and recommendations.
              </p>
            </div>

            <Surface tone="sunken" className="w-full max-w-[360px] flex flex-col gap-2.5">
              {name && <SummaryRow label="Name" value={name} />}
              {annualIncome && <SummaryRow label="Income" value={formatMoney(parseFloat(annualIncome), true)} mono />}
              {employmentType && <SummaryRow label="Work" value={EMPLOYMENT_SUMMARY[employmentType] ?? employmentType} />}
              <SummaryRow label="Risk" value={RISK_LEVELS.find((r) => r.value === riskTolerance)?.summary ?? 'Medium'} />
              {retirementAge && <SummaryRow label="Retire at" value={retirementAge} mono />}
              {linkedViaPlaid && (
                <div className="flex items-baseline justify-between text-sm text-content-muted">
                  <span>Bank</span>
                  <span className="font-semibold text-brand">Linked via Plaid</span>
                </div>
              )}
            </Surface>

            {/* Owner-only, optional: invite a partner into this household. Fully
                skippable — the owner can just continue to the dashboard. */}
            {isOwner && <InvitePartnerCard />}

            <div className="w-full max-w-[360px] flex flex-col items-center gap-2.5 pt-1">
              <Button className="w-full" onClick={handleConnectAccounts}
                leadingIcon={<Link2 className="h-4 w-4" />}>
                Connect accounts
              </Button>
              <button
                type="button"
                onClick={finishOnboarding}
                className="ui-focus rounded-ui-md px-2 py-1 text-[13px] font-medium text-content-muted transition-colors hover:text-content"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const canProceed = step < 3 && !blockedReason;

  if (initializing) {
    return (
      <div className="ui-root min-h-dvh bg-canvas flex items-start justify-center pt-24 sm:items-center sm:pt-0">
        <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
      </div>
    );
  }

  return (
    // h-dvh (not min-h-dvh) so <main> is the thing that scrolls and the
    // Back/Next bar stays on screen. A tall step used to push Next to y≈991 on
    // a 844px phone, below everything the user had to scroll past.
    <div className="ui-root h-dvh bg-canvas flex flex-col text-content">
      {/* Ambient warm glow — faint, single brand accent for atmosphere. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[720px] h-[720px] rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--ui-brand-soft), transparent 68%)' }}
        />
      </div>

      <header className="relative flex items-center justify-between px-6 py-[18px]">
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="font-editorial text-lg font-medium tracking-[-0.015em] text-content">
            Lasagna<span className="text-brand">Fi</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {step < totalSteps - 1 && (
            <span className="text-[13px] font-medium text-content-muted">Step {step + 1} of {totalSteps - 1}</span>
          )}
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="ui-focus inline-flex items-center gap-1.5 rounded-ui-md text-[13px] font-medium text-content-muted transition-colors hover:text-content"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Exit
          </button>
        </div>
      </header>

      {step < 3 && (
        <div className="relative px-6 pb-3">
          <div className="mx-auto h-1.5 w-full max-w-[640px] overflow-hidden rounded-full bg-canvas-sunken">
            <motion.div className="h-full rounded-full bg-brand" initial={false}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} />
          </div>
        </div>
      )}

      <main className="relative flex-1 min-h-0 flex items-start justify-center overflow-y-auto px-4 py-8">
        <div className="w-full max-w-[540px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div key={step} custom={direction} variants={slideVariants}
              initial="enter" animate="center" exit="exit"
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              <Surface tone="panel" className="shadow-ui-lg p-6 sm:p-7">{renderStep()}</Surface>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {step < 3 && (
        <footer className="relative border-t border-line px-6 py-4">
          <div className="mx-auto flex w-full max-w-[540px] flex-col gap-2">
            {blockedReason && (
              <p className="text-[13px] text-content-secondary">{blockedReason}</p>
            )}
            <div className="flex items-center justify-between">
              <div>
                {step > 0 && (
                  <Button variant="ghost" onClick={goBack} leadingIcon={<ChevronLeft className="h-4 w-4" />}>
                    Back
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={goNext} disabled={!canProceed || saving} loading={saving}
                  trailingIcon={!saving ? <ChevronRight className="h-4 w-4" /> : undefined}>
                  {step === 2 ? 'Finish' : 'Next'}
                </Button>
              </div>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

const EMPLOYMENT_SUMMARY: Record<string, string> = {
  w2: 'Employee',
  self_employed: 'Self-employed',
  '1099': 'Contractor',
  business_owner: 'Business owner',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Optional invite-a-partner step, rendered on the owner's "all set" screen.
// Skippable: doing nothing and continuing to the dashboard is fine.
function InvitePartnerCard() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const invite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.household.createInvite(trimmed);
      setEmail('');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that invite.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface tone="sunken" className="w-full max-w-[360px] flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-brand" aria-hidden />
        <h3 className="text-[15px] font-semibold text-content">Invite a partner (optional)</h3>
      </div>
      <p className="text-[13px] leading-relaxed text-content-secondary">
        Share these accounts with a spouse or partner. They'll get their own login and private chat.
      </p>
      <div className="flex flex-col gap-2">
        <Input
          type="email"
          enterKeyHint="send"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSent(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void invite(); }}
          placeholder="partner@example.com"
          leadingIcon={<Mail className="h-4 w-4" />}
          autoComplete="off"
        />
        <Button variant="secondary" onClick={() => void invite()} loading={busy} disabled={busy}>
          Send invite
        </Button>
      </div>
      {error && <p role="alert" className="text-[12.5px] font-medium text-negative">{error}</p>}
      {sent && !error && (
        <p className="text-[12.5px] font-medium text-positive">Invite sent. They'll get a link by email.</p>
      )}
    </Surface>
  );
}

function SummaryRow({ label, value, mono }: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm text-content-muted">
      <span>{label}</span>
      <span className={cn('font-semibold text-content', mono && 'ui-tnum')}>{value}</span>
    </div>
  );
}
