import { useState, useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Check,
  Loader2,
  Link2,
  ArrowRight,
  Briefcase,
  User,
  FileText,
  Store,
  Lock,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { BrandMark } from '../components/common/BrandMark';
import { Button, Surface, Field, Input, Label, MoneyInput } from '../components/uikit';
import {
  EASE, Stagger, Rise, LasagnaLayers, SegmentProgress, StepList, ChoiceField,
  PillChips, IconCards, LineCards, RoundPicker, NumberStepper, FinishBurst,
  VALUE_INPUT, VALUE_TEXT, CHOICE_TEXT,
} from '../components/onboarding/story';
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

// The stored values are unchanged. Only the wording is: each option now names
// what a bad year does to the money and what the user gets for putting up with
// it, instead of naming an investor posture.
const RISK_LEVELS = [
  { value: 'conservative', label: 'Almost no drop, and the slowest growth', summary: 'Very low' , path: 'M2 8 L18 7 L34 6 L50 5 L72 3' },
  { value: 'moderate_conservative', label: 'A small drop, and slow growth', summary: 'Low' , path: 'M2 9 L18 7 L30 11 L48 6 L72 3' },
  { value: 'moderate', label: 'A real drop, and moderate growth', summary: 'Medium' , path: 'M2 10 L16 6 L30 14 L48 7 L72 2' },
  { value: 'moderate_aggressive', label: 'A big drop, and fast growth', summary: 'High' , path: 'M2 12 L14 5 L28 18 L46 8 L72 1' },
  { value: 'aggressive', label: 'A very big drop, and the fastest growth', summary: 'Very high' , path: 'M2 14 L12 4 L26 21 L44 9 L72 1' },
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

// Keyed by user, so a second account in the same browser never inherits the
// first one's answers. Cleared on finish here and on sign-out in auth.tsx.
const TRI_DRAFT_PREFIX = 'lf_onboarding_tri:';
type TriDraft = { matchAnswer?: Tri; hdhp?: Tri; pslf?: Tri };
function readTriDraft(userId: string): TriDraft {
  try { return JSON.parse(localStorage.getItem(TRI_DRAFT_PREFIX + userId) ?? '{}') as TriDraft; } catch { return {}; }
}
function writeTriDraft(userId: string, d: TriDraft) {
  try { localStorage.setItem(TRI_DRAFT_PREFIX + userId, JSON.stringify(d)); } catch { /* storage blocked */ }
}
function clearTriDraft(userId: string) {
  try { localStorage.removeItem(TRI_DRAFT_PREFIX + userId); } catch { /* storage blocked */ }
}

const triToBool = (v: Tri): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);
const boolToTri = (v: boolean | null | undefined): Tri => (v === true ? 'yes' : v === false ? 'no' : '');

const slideVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  // A quick exit: the rail title changes on click, and a slow fade left the
  // old form under the new title for half a second.
  exit: (direction: number) => ({ x: direction > 0 ? -40 : 40, opacity: 0, transition: { duration: 0.15 } }),
};

// What the rail says on each question step, and its name in the step list.
const STEPS = [
  { nav: 'About you', title: "Let's get to know you", sub: 'A few basics about you. Everything else is worked out from these.' },
  { nav: 'Retirement match', title: 'Retirement match', sub: 'What your employer adds, how much risk you can take, and when you want to stop working.' },
  { nav: 'Situation', title: 'Your situation', sub: 'A few things that change which accounts and benefits you can use.' },
];

const WORK_TYPES = [
  { value: 'w2', label: 'Employee', icon: <Briefcase className="h-[18px] w-[18px]" aria-hidden /> },
  { value: 'self_employed', label: 'Self-employed', icon: <User className="h-[18px] w-[18px]" aria-hidden /> },
  { value: '1099', label: 'Contractor', icon: <FileText className="h-[18px] w-[18px]" aria-hidden /> },
  { value: 'business_owner', label: 'Business owner', icon: <Store className="h-[18px] w-[18px]" aria-hidden /> },
];

/** Income as one big number, with thousands separators as it is typed. */
function MoneyField({ value, onChange, placeholder }: {
  value: string; onChange: (digits: string) => void; placeholder?: string;
}) {
  return (
    <MoneyInput
      type="text"
      inputMode="numeric"
      value={value ? Number(value).toLocaleString('en-US') : ''}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
      placeholder={placeholder}
      className={cn(VALUE_INPUT, 'pl-[34px] ui-tnum')}
      leadingIcon={<span className={cn(VALUE_TEXT, 'text-content-faint')}>$</span>}
    />
  );
}

// Typed as MM/DD/YYYY, slashes added as the user types. Answers in
// 1960 used to take three lists and sixty years of scrolling.
const toDisplay = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return iso ? `${m}/${d}/${y}` : '';
};
const formatDobDigits = (digits: string) =>
  [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');

/**
 * Date of birth as one typed field. The parent only ever sees '' or a whole
 * ISO date, plus whether what is typed is usable, so a half-typed or
 * impossible date blocks Next instead of being dropped without a word.
 */
function DateOfBirthField({ value, onChange, onBlur }: {
  value: string;
  onChange: (iso: string, valid: boolean) => void;
  onBlur: () => void;
}) {
  const [text, setText] = useState(() => toDisplay(value));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) setText(toDisplay(value));
  }, [value]);

  const thisYear = new Date().getFullYear();
  const minYear = thisYear - 100;
  const maxYear = thisYear - 13;

  const check = (digits: string): { iso: string; error?: string } => {
    if (!digits) return { iso: '' };
    if (digits.length < 8) return { iso: '', error: 'Enter the full date, like 04/17/1990.' };
    const m = Number(digits.slice(0, 2)), d = Number(digits.slice(2, 4)), y = Number(digits.slice(4));
    if (m < 1 || m > 12 || d < 1 || d > new Date(y, m, 0).getDate()) {
      return { iso: '', error: 'That date does not exist. Enter it as MM/DD/YYYY.' };
    }
    if (y < minYear || y > maxYear) return { iso: '', error: `Enter a year from ${minYear} to ${maxYear}.` };
    return { iso: `${digits.slice(4)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}` };
  };

  const digits = text.replace(/\D/g, '');
  const { error } = check(digits);

  const handleChange = (el: HTMLInputElement) => {
    let raw = el.value;
    let caret = el.selectionStart ?? raw.length;
    const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      raw = `${iso[2]}/${iso[3]}/${iso[1]}`;
      caret = raw.length;
    } else if (raw.length > text.length) {
      // A typed or pasted slash closes its part, so "4/7/1990" means 04/07.
      const parts = raw.split('/');
      raw = parts.map((seg, i) => (i < parts.length - 1 && seg.replace(/\D/g, '').length === 1 ? `0${seg}` : seg)).join('/');
      caret += raw.length - el.value.length;
    }
    let next = raw.replace(/\D/g, '').slice(0, 8);
    let digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
    // Backspacing over a slash removes no digit, so the slash would come
    // straight back. Take the digit before it instead.
    if (raw.length < text.length && next === digits && digitsBefore > 0) {
      next = next.slice(0, digitsBefore - 1) + next.slice(digitsBefore);
      digitsBefore -= 1;
    }
    const formatted = formatDobDigits(next);
    setText(formatted);
    // Reformatting moves the caret to the end. Put it back after the same
    // number of digits, so an edit in the middle stays in the middle.
    let pos = 0;
    for (let seen = 0; pos < formatted.length && seen < digitsBefore; pos++) {
      if (/\d/.test(formatted[pos])) seen++;
    }
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(pos, pos));
    const r = check(next);
    onChange(r.iso, !r.error);
  };

  return (
    <Field label="Date of birth" required
      hint="So we can work out how long your money needs to last."
      error={touched ? error : undefined}>
      <Input ref={inputRef} type="text" inputMode="numeric" autoComplete="bday" placeholder="MM/DD/YYYY"
        value={text} maxLength={10} className={cn(VALUE_INPUT, 'ui-tnum')}
        invalid={touched && !!error}
        onChange={(e) => handleChange(e.target)}
        onBlur={() => { setTouched(true); onBlur(); }} />
    </Field>
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
      // Clamped at the ends, the same as the merchant typeahead.
      setActive((i) => (e.key === 'ArrowDown' ? Math.min(matches.length - 1, i + 1) : Math.max(0, i - 1)));
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
        className={cn(VALUE_INPUT, 'pr-10')}
        placeholder="Type a state"
        value={open ? query : selected?.name ?? ''}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
        onClick={openList}
        onKeyDown={onKeyDown}
      />
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-[26px] h-4 w-4 -translate-y-1/2 text-content-muted"
        aria-hidden
      />
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className={cn(
            'absolute left-0 right-0 z-30 max-h-[240px] overflow-y-auto rounded-ui-md border border-line-strong bg-panel-raised py-1 shadow-ui-lg',
            dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {matches.length === 0 ? (
            <p className={cn('px-3 py-2 text-content-muted', CHOICE_TEXT)}>No state matches that.</p>
          ) : (
            matches.map((s, i) => (
              <div
                key={s.code}
                id={`${listId}-${s.code}`}
                role="option"
                aria-selected={s.code === value}
                data-active={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => { e.preventDefault(); pick(s.code); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex min-h-touch cursor-pointer items-center justify-between gap-2 px-3 text-content sm:min-h-0 sm:py-2',
                  CHOICE_TEXT,
                  i === active && 'bg-canvas-sunken',
                )}
              >
                <span className="truncate">{s.name}</span>
                {s.code === value && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const STAGE_TO_STEP: Record<string, number> = {
  // 'accounts' is a legacy stage (the dedicated connect step was removed) —
  // map it to the final connect-an-account screen (step 3).
  profile: 0, income: 1, lifestyle: 2, accounts: 3, complete: 3,
};

export function Onboarding() {
  const [, navigate] = useLocation();
  const { user, setOnboardingStage, setOnboardingDeferred } = useAuth();
  const userId = user?.id ?? '';
  const [initializing, setInitializing] = useState(true);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Step 1
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [dobValid, setDobValid] = useState(true);
  const [dobTouched, setDobTouched] = useState(false);
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
      // The profile stores "Yes, but I don't know the %" and "I'm not sure" as
      // unknown, which reads back as unanswered. This browser remembers them.
      const draft = readTriDraft(userId);
      if (fp?.employerMatchPercent == null && draft.matchAnswer) setMatchAnswer(draft.matchAnswer);
      if (fp?.hasHDHP == null && draft.hdhp) setHdhp(draft.hdhp);
      if (fp?.isPSLFEligible == null && draft.pslf) setPslf(draft.pslf);

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
    : step === 0 && !annualIncome.trim() ? 'Add your income to continue.'
    // Said only once the field itself shows its error, never mid-typing.
    : step === 0 && !dobValid && dobTouched ? 'Fix your date of birth to continue.'
    : step === 0 && !dob && dobValid ? 'Add your date of birth to continue.'
    : step === 0 && !stateOfResidence ? 'Add your state to continue.'
    : step === 0 && !filingStatus ? 'Pick a filing status to continue.'
    : step === 1 && !retirementAge ? 'Add a retirement age to continue.'
    : null;

  // Saves the answers on the current screen. Next and Finish later both use it,
  // so leaving early never drops what was typed.
  const saveStep = useCallback(async () => {
    writeTriDraft(userId, { matchAnswer, hdhp, pslf });
    try {
      if (step === 0) {
        await api.updateProfile({ name: name.trim() });
        await api.updateFinancialProfile({
          dateOfBirth: dob || null,
          // "I'm not sure" and "not answered" are both stored as unknown, which
          // is what the rest of the app already reads null as.
          filingStatus: filingStatus && filingStatus !== 'unsure' ? filingStatus : null,
          stateOfResidence: stateOfResidence || null,
          annualIncome: annualIncome ? parseFloat(annualIncome) : null,
        });
      } else if (step === 1) {
        await api.updateFinancialProfile({
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
    }
  }, [userId, step, name, dob, filingStatus, stateOfResidence, annualIncome, matchAnswer, matchPercent, riskTolerance, retirementAge, employmentType, dependentCount, hdhp, pslf]);

  const goNext = useCallback(async () => {
    setSaving(true);
    await saveStep();
    setSaving(false);
    const nextStep = Math.min(step + 1, totalSteps - 1);
    const nextStage = STEP_TO_STAGE[nextStep] ?? null;
    await api.updateOnboardingStage(nextStage).catch(() => {});
    setDirection(1);
    setStep(nextStep);
  }, [step, saveStep]);

  // Into the app with onboarding unfinished. The stage already points at this
  // screen, and the home card and sidebar bring the user back to it.
  const finishLater = async () => {
    setLeaving(true);
    await saveStep();
    await api.updateOnboardingDeferred(true).catch(() => {});
    setLeaving(false);
    // Next only told the server which step this is, and the progress card
    // reads it from here.
    setOnboardingStage(STEP_TO_STAGE[step]);
    setOnboardingDeferred(true);
    navigate('/');
  };

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // Mark onboarding complete (server + local state) so the guarded app opens.
  const finishOnboarding = async () => {
    clearTriDraft(userId);
    await api.updateOnboardingStage(null).catch(() => {});
    setOnboardingStage(null);
  };

  // Primary completion action: finish onboarding, then hand off to the real
  // accounts page which auto-opens Plaid Link on ?autoLink=true.
  const handleConnectAccounts = async () => {
    await finishOnboarding();
    navigate('/accounts?autoLink=true');
  };

  // Years from now to the target age, once both answers are in. Shown under
  // the stepper so the number means something as it changes.
  const yearsToRetire = (() => {
    if (!dob || !retirementAge) return null;
    const born = new Date(`${dob}T00:00:00`);
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) age -= 1;
    return Number(retirementAge) - age;
  })();
  const retireHintId = useId();

  // The form column keeps its scroll offset across steps, so a long step 3
  // opened the finish screen halfway down. Every step starts at its top.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [step]);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Stagger className="flex flex-col gap-[22px]">
            <Rise>
              <Field label="Your name" required>
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Alex" autoFocus className={VALUE_INPUT} />
              </Field>
            </Rise>

            <Rise>
              <Field label="Annual income before tax" required
                hint="So we can tell you how much of what you earn is actually being saved.">
                <MoneyField value={annualIncome} onChange={setAnnualIncome} placeholder="75,000" />
              </Field>
            </Rise>

            {/* Stacked at every width: at 20px a long state ("District of Columbia")
                did not fit half of a 500px column. */}
            <Rise className="grid gap-[22px]">
              <DateOfBirthField value={dob}
                onChange={(iso, valid) => { setDob(iso); setDobValid(valid); }}
                onBlur={() => setDobTouched(true)} />
              <Field label="State of residence" required
                hint="Some states tax what you earn and some do not.">
                <StatePicker value={stateOfResidence} onChange={setStateOfResidence} />
              </Field>
            </Rise>

            <Rise>
              <ChoiceField label="Filing status" required
                hint="Tax rules differ by filing status, and it changes what you can save tax-free.">
                <PillChips options={[...FILING_STATUSES, { value: 'unsure', label: "I'm not sure" }]}
                  value={filingStatus} onChange={setFilingStatus} />
              </ChoiceField>
            </Rise>
          </Stagger>
        );

      case 1:
        return (
          <Stagger className="flex flex-col gap-[22px]">
            <Rise>
              <ChoiceField label="Does your employer add money when you save for retirement?">
                <PillChips options={TRI_OPTIONS} value={matchAnswer} onChange={setMatchAnswer} />
              </ChoiceField>
              {matchAnswer === 'yes' && (
                <motion.div className="mt-3 space-y-1.5"
                  initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  <Label htmlFor={matchPercentId}>How much of your pay do they add?</Label>
                  <div className="relative max-w-[180px]">
                    <Input id={matchPercentId} type="text" inputMode="decimal"
                      aria-describedby={`${matchPercentId}-desc`}
                      value={matchPercent}
                      onChange={(e) => setMatchPercent(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="3" className={cn(VALUE_INPUT, 'pr-9 ui-tnum')} />
                    <span className={cn('pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-faint', VALUE_TEXT)}>%</span>
                  </div>
                  <p id={`${matchPercentId}-desc`} className="text-[12px] text-content-muted">
                    Leave this blank if you do not know it.
                  </p>
                </motion.div>
              )}
            </Rise>

            <Rise>
              <ChoiceField label="In a bad year, how much of a drop could you live with?">
                <LineCards options={RISK_LEVELS} value={riskTolerance} onChange={setRiskTolerance} />
              </ChoiceField>
            </Rise>

            <Rise>
              <div className="space-y-1.5">
                <Label id={`${retireHintId}-label`}>Target retirement age</Label>
                <div role="group" aria-labelledby={`${retireHintId}-label`}>
                  <NumberStepper value={retirementAge} onChange={setRetirementAge} min={30} max={90}
                    decLabel="One year earlier" incLabel="One year later" describedBy={retireHintId} />
                </div>
                <p id={retireHintId} className="text-[12px] text-content-muted">
                  {yearsToRetire !== null && yearsToRetire <= 0
                    ? 'You are already past that age.'
                    : yearsToRetire
                    ? `That is ${yearsToRetire} ${yearsToRetire === 1 ? 'year' : 'years'} from now.`
                    : 'We will check whether what you save now gets you there.'}
                </p>
              </div>
            </Rise>
          </Stagger>
        );

      case 2:
        return (
          <Stagger className="flex flex-col gap-[22px]">
            <Rise>
              <ChoiceField label="What kind of work do you do?"
                hint="Working for yourself opens retirement accounts an employee cannot use.">
                <IconCards value={employmentType} onChange={setEmploymentType} options={WORK_TYPES} />
              </ChoiceField>
            </Rise>

            <Rise>
              <ChoiceField label="How many dependents do you have, not counting a spouse?"
                hint="People who depend on you change what is worth insuring and saving for.">
                <RoundPicker value={dependentCount} onChange={setDependentCount}
                  options={[0, 1, 2, 3, 4].map((n) => ({
                    value: n, label: n === 4 ? '4+' : String(n), ariaLabel: n === 4 ? '4 or more' : undefined,
                  }))} />
              </ChoiceField>
            </Rise>

            <Rise>
              <ChoiceField label="Do you have a high deductible health plan? (HDHP)"
                hint="A high deductible means you pay more yourself before the plan starts paying. If yours does, you can use a savings account that is never taxed.">
                <PillChips options={TRI_OPTIONS} value={hdhp} onChange={setHdhp} />
              </ChoiceField>
            </Rise>

            <Rise>
              <ChoiceField label="Do you work for the government or a non-profit?"
                hint="Government and non-profit workers can have student loans forgiven after 10 years of payments.">
                <PillChips options={TRI_OPTIONS} value={pslf} onChange={setPslf} />
              </ChoiceField>
            </Rise>
          </Stagger>
        );

      case 3: {
        const summary = (
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
        );
        return (
          <Stagger className="flex flex-col items-center gap-[22px] text-center md:items-start md:text-left">
            <Rise><FinishBurst icon={<Check className="h-[34px] w-[34px]" strokeWidth={2.5} />} /></Rise>
            <Rise>
              <p className="max-w-[46ch] text-[15.5px] leading-relaxed text-content-secondary">
                {linkedViaPlaid
                  ? 'Your dashboard is ready.'
                  : 'Connect an account next. Your dashboard, plan and insights are built from your balances and transactions.'}
              </p>
            </Rise>
            {linkedViaPlaid ? (
              <>
                <Rise className="w-full max-w-[360px]">{summary}</Rise>
                <Rise className="w-full max-w-[360px]">
                  <Button size="lg" className="w-full" onClick={finishOnboarding}>Go to dashboard</Button>
                </Rise>
              </>
            ) : (
              <>
                <Rise className="w-full max-w-[360px]">
                  <Button size="lg" className="w-full" onClick={handleConnectAccounts}
                    leadingIcon={<Link2 className="h-4 w-4" />}>
                    Connect accounts
                  </Button>
                </Rise>
                {/* The two ways out, as a pair: the same "or" rule the login screen uses. */}
                <Rise className="flex w-full max-w-[360px] items-center gap-3">
                  <div className="h-px flex-1 bg-line" />
                  <span className="text-xs text-content-muted">or</span>
                  <div className="h-px flex-1 bg-line" />
                </Rise>
                <Rise className="w-full max-w-[360px]">
                  <Button variant="ghost" className="w-full text-content-muted hover:text-content md:justify-start" onClick={finishOnboarding}>
                    Skip for now (you can add accounts later)
                  </Button>
                </Rise>
                <Rise className="w-full max-w-[360px]">
                  <ul className="flex w-full flex-col items-center gap-1.5 md:items-start">
                    {TRUST_POINTS.map(({ icon: Icon, label }) => (
                      <li key={label} className="flex items-center gap-2 text-[13px] text-content-muted">
                        <Icon className="h-3 w-3 shrink-0" aria-hidden />
                        {label}
                      </li>
                    ))}
                  </ul>
                </Rise>
                {/* Unlinked, the recap follows the ask: it confirms the answers
                    landed without standing between the user and the one step left. */}
                <Rise className="w-full max-w-[360px]">{summary}</Rise>
              </>
            )}
          </Stagger>
        );
      }

      default:
        return null;
    }
  };

  const canProceed = step < 3 && !blockedReason && !(step === 0 && !dobValid);

  // The rail tells the story: what this step is, and a lasagna that gains a
  // layer for each finished step and its top layer at the finish.
  const railTitle = step === 3 ? (linkedViaPlaid ? "You're all set" : 'Your profile is done') : STEPS[step].title;
  const railSub = step === 3 ? 'You can change any answer later in your profile.' : STEPS[step].sub;
  const layers = step + 1;

  if (initializing) {
    return (
      <div className="ui-root min-h-dvh bg-canvas flex items-start justify-center pt-24 sm:items-center sm:pt-0">
        <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    {/* h-dvh (not min-h-dvh) so the form column is the thing that scrolls and
        the Back/Next bar stays on screen. */}
    <div className="ui-root relative h-dvh bg-canvas flex flex-col text-content">
      <div className="pointer-events-none fixed inset-0" aria-hidden
        style={{ background: 'radial-gradient(520px 380px at 0% 0%, var(--ui-caution-soft), transparent 70%)' }} />

      <header className="relative flex items-center justify-between gap-3 px-5 py-4 md:px-6">
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <span className="font-editorial text-lg font-medium tracking-[-0.015em] text-content">
            Lasagna<span className="text-brand">Fi</span>
          </span>
        </div>
        <div className="flex items-center gap-4">
          {step < totalSteps - 1 && (
            // On md+ the rail's step list already says this.
            <span className="text-[13px] font-medium text-content-muted md:hidden">Step {step + 1} of {totalSteps - 1}</span>
          )}
          {/* Not on step 1: name and income are what the app needs to work.
              Not on the connect screen: its own "Skip for now" already leaves. */}
          {step > 0 && step < totalSteps - 1 && (
            <button
              type="button"
              onClick={() => { void finishLater(); }}
              disabled={saving || leaving}
              className="group ui-focus -mx-2 -my-2 inline-flex min-h-11 items-center gap-1 rounded-ui-md px-2 text-[13px] font-semibold text-[rgb(var(--ui-brand-ink))] transition-colors hover:bg-brand-softer disabled:opacity-50"
            >
              Finish later
              {leaving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                : <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 ease-ui group-hover:translate-x-0.5" aria-hidden />}
            </button>
          )}
        </div>
      </header>

      {/* Phones have no rail, so the step list's job falls to this bar. */}
      {step < 3 && <SegmentProgress step={step} className="relative mx-auto w-full max-w-[640px] px-5 pb-1.5 md:hidden" />}

      <div className="relative flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(300px,40%)_1fr]">
        <aside
          className="hidden md:flex flex-col gap-[22px] overflow-hidden border-r border-line px-[34px] py-7"
          style={{ background: 'linear-gradient(165deg, var(--ui-brand-softer), var(--ui-caution-soft))' }}
        >
          <LasagnaLayers layers={layers} className="w-full max-w-[260px]" />
          <Stagger key={step} className="grid gap-2.5">
            <Rise>
              <h1 className="font-display text-[46px] font-semibold leading-[1.02] tracking-[-0.025em] text-content text-balance">
                {railTitle}
              </h1>
            </Rise>
            <Rise>
              <p className="max-w-[46ch] text-[15.5px] leading-relaxed text-content-secondary">{railSub}</p>
            </Rise>
          </Stagger>
          <div className="mt-auto">
            <StepList steps={STEPS.map((s) => s.nav)} step={step} />
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <main ref={mainRef} className="relative min-h-0 flex-1 overflow-y-auto">
            {/* The rail, folded into a strip above the form. */}
            <div className="flex items-center gap-4 border-b border-line px-5 py-4 md:hidden"
              style={{ background: 'linear-gradient(165deg, var(--ui-brand-softer), var(--ui-caution-soft))' }}>
              <LasagnaLayers layers={layers} className="w-[86px] flex-none" />
              <h1 className="font-display text-[28px] font-semibold leading-[1.05] tracking-[-0.025em] text-content text-balance">
                {railTitle}
              </h1>
            </div>
            <div className="px-5 pb-8 pt-6 md:px-11 md:pb-12 md:pt-9">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div key={step} custom={direction} variants={slideVariants}
                  initial="enter" animate="center" exit="exit"
                  transition={{ duration: 0.45, ease: EASE }}
                  // Labels are what the user reads first on every step, so they
                  // are set larger here than the app's 13px form default.
                  className="max-w-[500px] [&_label]:text-[15px] [&_label]:font-semibold [&_label]:text-content [&_label]:text-pretty">
                  {renderStep()}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>

          {step < 3 && (
            <footer className="relative border-t border-line bg-canvas/85 px-5 py-3.5 backdrop-blur md:px-11">
              <div className="flex w-full max-w-[500px] flex-col gap-2">
                {blockedReason && (
                  <p className="text-[13px] text-content-secondary">{blockedReason}</p>
                )}
                <div className="flex items-center justify-between">
                  <div>
                    {step > 0 && (
                      <Button variant="ghost" onClick={goBack} disabled={leaving} leadingIcon={<ChevronLeft className="h-4 w-4" />}>
                        Back
                      </Button>
                    )}
                  </div>
                  <Button onClick={goNext} disabled={!canProceed || saving || leaving} loading={saving}
                    trailingIcon={!saving ? <ChevronRight className="h-4 w-4" /> : undefined}>
                    {step === 2 ? 'Finish' : 'Next'}
                  </Button>
                </div>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
    </MotionConfig>
  );
}

const EMPLOYMENT_SUMMARY: Record<string, string> = {
  w2: 'Employee',
  self_employed: 'Self-employed',
  '1099': 'Contractor',
  business_owner: 'Business owner',
};

// Shown under the connect button, the moment the user decides whether to link.
const TRUST_POINTS = [
  { icon: Lock, label: 'Bank-level encryption' },
  { icon: Eye, label: "Read-only. We can't move money." },
  { icon: RefreshCw, label: 'Balances update automatically' },
];

function SummaryRow({ label, value, mono }: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm text-content-muted">
      <span className="shrink-0">{label}</span>
      <span className={cn('min-w-0 break-words text-right font-semibold text-content', mono && 'ui-tnum')}>{value}</span>
    </div>
  );
}
