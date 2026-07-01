import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  X,
  Loader2,
  Link2,
  PencilLine,
  Sparkles,
} from 'lucide-react';
import { BrandMark } from '../components/common/BrandMark';
import { Button, Surface, Field, Input, Label, Select, Badge, Eyebrow } from '../components/uikit';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatMoney } from '../lib/utils';

const STEP_TO_STAGE = ['profile', 'income', 'lifestyle', 'accounts', 'complete'] as const;

// ─── US States ────────────────────────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

// ─── Account type definitions for manual entry ───────────
interface AccountTypeDef {
  label: string;
  emoji: string;
  type: string;
  subtype?: string;
  isDebt: boolean;
}

const ACCOUNT_TYPES: AccountTypeDef[] = [
  { label: 'Checking / Savings', emoji: '💵', type: 'depository', isDebt: false },
  { label: '401(k) / 403(b)', emoji: '📈', type: 'investment', subtype: '401k', isDebt: false },
  { label: 'Roth IRA', emoji: '🌱', type: 'investment', subtype: 'roth_ira', isDebt: false },
  { label: 'Traditional IRA', emoji: '📊', type: 'investment', subtype: 'ira', isDebt: false },
  { label: 'Brokerage', emoji: '💼', type: 'investment', subtype: 'brokerage', isDebt: false },
  { label: 'HSA', emoji: '🏥', type: 'investment', subtype: 'hsa', isDebt: false },
  { label: 'Primary Residence', emoji: '🏡', type: 'real_estate', subtype: 'primary', isDebt: false },
  { label: 'Rental Property', emoji: '🏢', type: 'real_estate', subtype: 'rental', isDebt: false },
  { label: 'Credit Card', emoji: '💳', type: 'credit', isDebt: true },
  { label: 'Student Loan', emoji: '🎓', type: 'loan', subtype: 'student', isDebt: true },
  { label: 'Auto Loan', emoji: '🚗', type: 'loan', subtype: 'auto', isDebt: true },
  { label: 'Mortgage', emoji: '🏠', type: 'loan', subtype: 'mortgage', isDebt: true },
];

const RISK_LEVELS = [
  { value: 'conservative', label: 'Conservative', desc: 'Preserve capital' },
  { value: 'moderate_conservative', label: 'Moderately Conservative', desc: 'Mostly stable' },
  { value: 'moderate', label: 'Moderate', desc: 'Balanced growth' },
  { value: 'moderate_aggressive', label: 'Moderately Aggressive', desc: 'Growth focused' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Maximum growth' },
];

const FILING_STATUSES = [
  { value: 'single', label: 'Single' },
  { value: 'married_joint', label: 'Married Filing Jointly' },
  { value: 'married_separate', label: 'Married Filing Separately' },
  { value: 'head_of_household', label: 'Head of Household' },
];

interface AddedAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  emoji: string;
}

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
    <Input
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

const STAGE_TO_STEP: Record<string, number> = {
  profile: 0, income: 1, lifestyle: 2, accounts: 3, complete: 4,
};

export function Onboarding() {
  const [, navigate] = useLocation();
  const { setOnboardingStage } = useAuth();
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
  const [has401k, setHas401k] = useState(true);
  const [matchPercent, setMatchPercent] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('');
  const [retirementAge, setRetirementAge] = useState('65');

  // Step 2 — Life situation
  const [employmentType, setEmploymentType] = useState('w2');
  const [dependentCount, setDependentCount] = useState<number | null>(null);
  const [hasHDHP, setHasHDHP] = useState(false);
  const [isPSLFEligible, setIsPSLFEligible] = useState(false);

  // Step 3
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [addedAccounts, setAddedAccounts] = useState<AddedAccount[]>([]);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState('');
  const [acctBalance, setAcctBalance] = useState('');
  const [acctRate, setAcctRate] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);
  const [linkedViaPlaid, setLinkedViaPlaid] = useState(false);

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
        if (fp.employerMatchPercent !== null && fp.employerMatchPercent !== undefined) {
          setMatchPercent(String(fp.employerMatchPercent));
        }
        if (fp.employmentType) setEmploymentType(fp.employmentType);
        if (fp.dependentCount !== null && fp.dependentCount !== undefined) setDependentCount(fp.dependentCount);
        if (fp.hasHDHP) setHasHDHP(fp.hasHDHP);
        if (fp.isPSLFEligible) setIsPSLFEligible(fp.isPSLFEligible);
      }

      const hasPlaid = itemData.items.some((i: { institutionId: string | null }) => i.institutionId && i.institutionId !== 'manual');
      if (hasPlaid) setLinkedViaPlaid(true);

      // Use server-side stage as source of truth
      const serverStage = meData.user.onboardingStage;
      const startStep = serverStage ? (STAGE_TO_STEP[serverStage] ?? 0) : 0;
      setStep(startStep);
    }).finally(() => setInitializing(false));
  }, []);

  const totalSteps = 5;
  const step1Valid = name.trim().length > 0;
  const step2Valid = annualIncome.trim().length > 0 && riskTolerance.length > 0;

  const goNext = useCallback(async () => {
    setSaving(true);
    try {
      if (step === 0) {
        await api.updateProfile({ name: name.trim() });
        await api.updateFinancialProfile({
          dateOfBirth: dob || null,
          filingStatus: filingStatus || null,
          stateOfResidence: stateOfResidence || null,
        });
      } else if (step === 1) {
        await api.updateFinancialProfile({
          annualIncome: annualIncome ? parseFloat(annualIncome) : null,
          employerMatchPercent: has401k && matchPercent ? parseFloat(matchPercent) : (has401k ? 0 : null),
          riskTolerance,
          retirementAge: retirementAge ? parseInt(retirementAge) : 65,
        });
      } else if (step === 2) {
        await api.updateFinancialProfile({
          employmentType,
          dependentCount: dependentCount ?? 0,
          hasHDHP,
          isPSLFEligible,
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
  }, [step, name, dob, filingStatus, stateOfResidence, annualIncome, has401k, matchPercent, riskTolerance, retirementAge, employmentType, dependentCount, hasHDHP, isPSLFEligible]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const handleAddAccount = async () => {
    if (!activeType || !acctName.trim()) return;
    setAddingAccount(true);
    try {
      const balance = acctBalance ? parseFloat(acctBalance) : 0;
      const metadata: Record<string, unknown> = {};
      if (activeType.isDebt && acctRate) metadata.interestRate = parseFloat(acctRate);
      const result = await api.createManualAccount({
        name: acctName.trim(), type: activeType.type, subtype: activeType.subtype,
        balance, metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      setAddedAccounts((prev) => [...prev, { id: result.account.id, name: acctName.trim(), type: activeType.label, balance, emoji: activeType.emoji }]);
      setActiveType(null); setAcctName(''); setAcctBalance(''); setAcctRate('');
    } catch (err) { console.error('Failed to create account:', err); }
    finally { setAddingAccount(false); }
  };

  const handleRemoveAccount = async (id: string) => {
    try { await api.deleteManualAccount(id); setAddedAccounts((prev) => prev.filter((a) => a.id !== id)); }
    catch (err) { console.error('Failed to remove account:', err); }
  };

  const handleLinkPlaid = () => {
    // Navigate to accounts page which has the Plaid Link integration
    // Mark that user chose to link so we can show the completion step
    setLinkedViaPlaid(true);
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
                A few basics so we can personalize your projections and tax insights.
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
                  Quick Import — describe yourself instead
                </span>
              </div>
              <div className="text-[13px] text-content-muted">
                Type a sentence or two and we&apos;ll fill out your profile and accounts.
              </div>
            </button>

            <div className="flex flex-col gap-5">
              <Field label="Your name">
                <Input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Alex" autoFocus />
              </Field>

              <Field label="Date of birth"
                hint="Used for age-based retirement projections and catch-up contribution eligibility (50+).">
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </Field>

              <Field label="Filing status"
                hint="Determines tax bracket thresholds, Roth IRA income limits, and capital gains rates.">
                <Select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}>
                  <option value="">Select...</option>
                  {FILING_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>

              <Field label="State of residence"
                hint="Some states have no income tax — this affects your take-home pay and retirement planning.">
                <Select value={stateOfResidence} onChange={(e) => setStateOfResidence(e.target.value)}>
                  <option value="">Select...</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
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
                This drives your savings rate calculations, FIRE number, and retirement projections.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              <Field label="Annual gross income"
                hint="Used to calculate your savings rate, tax bracket, and how much to allocate to each financial layer.">
                <CurrencyInput value={annualIncome} onChange={setAnnualIncome} placeholder="75000" />
              </Field>

              <div>
                <Label>Employer 401(k) match</Label>
                <label className="mt-2 flex items-center gap-2 min-h-touch text-sm text-content-secondary cursor-pointer select-none">
                  <input type="checkbox" checked={!has401k} onChange={(e) => setHas401k(!e.target.checked)}
                    className="h-4 w-4 accent-[rgb(var(--ui-brand))]" />
                  I don&apos;t have a 401(k)
                </label>
                {has401k && (
                  <>
                    <div className="relative mt-2.5">
                      <Input type="number" min={0} max={10} step={0.5} value={matchPercent}
                        onChange={(e) => setMatchPercent(e.target.value)}
                        placeholder="3" className="ui-tnum pr-9" />
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted text-sm">%</span>
                    </div>
                    <p className="mt-1.5 text-[12px] text-content-muted">
                      Not maxing your employer match is leaving free money on the table — we&apos;ll flag this.
                    </p>
                  </>
                )}
              </div>

              <div>
                <Label>Risk tolerance</Label>
                <div className="mt-2 flex flex-col gap-2">
                  {RISK_LEVELS.map((r) => {
                    const active = riskTolerance === r.value;
                    return (
                      <button key={r.value} type="button" onClick={() => setRiskTolerance(r.value)}
                        className={cn('ui-focus', chipBase, active ? chipActive : chipInactive)}>
                        <span className="font-semibold">{r.label}</span>
                        <span className={cn('text-[12px]', active ? 'text-[rgb(var(--ui-brand-ink))]' : 'text-content-muted')}>{r.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] text-content-muted">
                  Shapes your portfolio allocation suggestions and retirement simulation parameters.
                </p>
              </div>

              <Field label="Target retirement age"
                hint="We'll project whether your current savings rate gets you there.">
                <Input type="number" min={30} max={80} value={retirementAge}
                  onChange={(e) => setRetirementAge(e.target.value)} className="ui-tnum" />
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
                Shapes which financial layers apply to you and in what order.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              {/* Employment type */}
              <div>
                <Label>Employment type</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { value: 'w2',             label: 'W2 employee' },
                    { value: 'self_employed',  label: 'Self-employed' },
                    { value: '1099',           label: '1099 / contractor' },
                    { value: 'business_owner', label: 'Business owner' },
                  ].map(opt => {
                    const active = employmentType === opt.value;
                    return (
                      <button key={opt.value} type="button" onClick={() => setEmploymentType(opt.value)}
                        className={cn('ui-focus justify-start', chipBase, active ? chipActive : chipInactive)}>
                        <span className="font-semibold">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] text-content-muted">
                  Determines which retirement accounts apply — 401(k), solo 401(k), SEP IRA, etc.
                </p>
              </div>

              {/* Dependents */}
              <div>
                <Label>Number of dependents</Label>
                <div className="mt-2 flex items-center gap-2">
                  {[0, 1, 2, 3, 4].map(n => {
                    const active = dependentCount === n;
                    return (
                      <button key={n} type="button" onClick={() => setDependentCount(n)}
                        className={cn(
                          'ui-focus h-12 w-12 rounded-ui-md border font-semibold text-[15px] ui-tnum transition-[background-color,border-color,color] duration-150 ease-ui',
                          active ? chipActive : chipInactive,
                        )}>
                        {n === 4 ? '4+' : n}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[12px] text-content-muted">
                  Surfaces life insurance, 529 savings, and dependent care FSA layers.
                </p>
              </div>

              {/* HDHP */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={hasHDHP} onChange={e => setHasHDHP(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]" />
                <div>
                  <p className="text-sm text-content">Enrolled in a high-deductible health plan (HDHP)</p>
                  <p className="text-[12px] text-content-muted">Enables HSA contributions — the only account with triple tax advantages.</p>
                </div>
              </label>

              {/* PSLF */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={isPSLFEligible} onChange={e => setIsPSLFEligible(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--ui-brand))]" />
                <div>
                  <p className="text-sm text-content">Work in public service (government or non-profit)</p>
                  <p className="text-[12px] text-content-muted">May qualify for PSLF — changes your student loan strategy significantly.</p>
                </div>
              </label>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="font-editorial text-[26px] sm:text-[30px] font-medium leading-[1.05] tracking-[-0.015em] text-content">
                Connect your accounts
              </h2>
              <p className="text-[15px] leading-relaxed text-content-secondary">
                Link your bank and investment accounts for automatic balance tracking, portfolio analysis, and spending insights.
              </p>
            </div>

            {/* Primary CTA: Link via Plaid */}
            <Surface tone="brand" className="flex flex-col items-center gap-2.5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-ui-md bg-panel/70 text-brand">
                <Link2 className="h-6 w-6" />
              </div>
              <h3 className="font-editorial text-[20px] font-medium tracking-[-0.01em] text-content">Link your accounts</h3>
              <p className="max-w-sm text-[14px] leading-relaxed text-content-secondary">
                Securely connect via Plaid. Your balances and holdings update automatically so your projections stay current.
              </p>
              <Button onClick={handleLinkPlaid} leadingIcon={<Link2 className="h-4 w-4" />} className="mt-1">
                Link Bank Account
              </Button>
              <p className="text-[12px] text-content-muted">
                256-bit encryption. Read-only access. We never store your bank credentials.
              </p>
            </Surface>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-line" />
              <Eyebrow className="text-content-muted">or enter manually</Eyebrow>
              <span className="h-px flex-1 bg-line" />
            </div>

            {/* Manual entry toggle */}
            {!showManualEntry ? (
              <Button variant="secondary" onClick={() => setShowManualEntry(true)}
                leadingIcon={<PencilLine className="h-4 w-4" />} className="w-full">
                Add accounts manually instead
              </Button>
            ) : (
              <div className="flex flex-col gap-5">
                {/* Added accounts */}
                {addedAccounts.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Label>Added accounts</Label>
                    {addedAccounts.map((acct) => (
                      <motion.div key={acct.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between rounded-ui-md border border-line bg-panel px-3.5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-lg leading-none">{acct.emoji}</span>
                          <div>
                            <p className="text-sm font-semibold text-content">{acct.name}</p>
                            <p className="text-[12px] text-content-muted">{acct.type}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-content-secondary ui-tnum">{formatMoney(acct.balance, true)}</span>
                          <button onClick={() => handleRemoveAccount(acct.id)}
                            className="ui-focus inline-flex h-8 w-8 items-center justify-center rounded-ui-md text-content-muted transition-colors hover:text-negative hover:bg-canvas-sunken"
                            aria-label="Remove account">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Inline add form */}
                {activeType && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <Surface tone="sunken" className="flex flex-col gap-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg leading-none">{activeType.emoji}</span>
                        <Badge tone="brand">{activeType.label}</Badge>
                      </div>
                      <Field label="Account name">
                        <Input type="text" value={acctName} onChange={(e) => setAcctName(e.target.value)} autoFocus />
                      </Field>
                      <Field label="Balance">
                        <CurrencyInput value={acctBalance} onChange={setAcctBalance} />
                      </Field>
                      {activeType.isDebt && (
                        <Field label="Interest rate">
                          <div className="relative">
                            <Input type="number" min={0} max={40} step={0.1} value={acctRate}
                              onChange={(e) => setAcctRate(e.target.value)} placeholder="5.5" className="ui-tnum pr-9" />
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-content-muted text-sm">%</span>
                          </div>
                        </Field>
                      )}
                      <div className="flex gap-2 pt-0.5">
                        <Button onClick={handleAddAccount} disabled={!acctName.trim() || addingAccount}
                          loading={addingAccount}
                          leadingIcon={!addingAccount ? <Plus className="h-4 w-4" /> : undefined}>
                          Add
                        </Button>
                        <Button variant="ghost" onClick={() => { setActiveType(null); setAcctName(''); setAcctBalance(''); setAcctRate(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </Surface>
                  </motion.div>
                )}

                {/* Account type grid */}
                {!activeType && (
                  <div className="grid grid-cols-2 gap-2">
                    {ACCOUNT_TYPES.map((at) => (
                      <button key={at.label}
                        onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(''); setAcctRate(''); }}
                        className="ui-focus flex items-center gap-2.5 min-h-[56px] rounded-ui-md border border-line-strong bg-panel px-3.5 py-3 text-left text-[13px] font-medium text-content-secondary transition-[background-color,border-color] duration-150 ease-ui hover:bg-canvas-sunken hover:border-line-heavy">
                        <span className="text-lg leading-none">{at.emoji}</span>
                        <span className="leading-tight">{at.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-center text-[12px] text-content-muted">
                  Manual balances are a snapshot — consider linking accounts for automatic updates.
                </p>
              </div>
            )}
          </div>
        );

      case 4:
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
              <Eyebrow>Summary</Eyebrow>
              {name && <SummaryRow label="Name" value={name} />}
              {annualIncome && <SummaryRow label="Income" value={formatMoney(parseFloat(annualIncome), true)} mono />}
              {employmentType && <SummaryRow label="Employment" value={employmentType.replace(/_/g, ' ')} capitalize />}
              {riskTolerance && <SummaryRow label="Risk" value={riskTolerance.replace(/_/g, ' ')} capitalize />}
              {retirementAge && <SummaryRow label="Retire at" value={retirementAge} mono />}
              {addedAccounts.length > 0 && <SummaryRow label="Accounts" value={`${addedAccounts.length} added`} />}
              {linkedViaPlaid && (
                <div className="flex items-baseline justify-between text-sm text-content-muted">
                  <span>Bank</span>
                  <span className="font-semibold text-brand">Linked via Plaid</span>
                </div>
              )}
            </Surface>

            <div className="w-full max-w-[360px] flex flex-col gap-2.5 pt-1">
              <Button className="w-full" trailingIcon={<ChevronRight className="h-4 w-4" />}
                onClick={async () => { await api.updateOnboardingStage(null).catch(() => {}); setOnboardingStage(null); }}>
                Go to Dashboard
              </Button>
              {!linkedViaPlaid && (
                <Button variant="ghost" className="w-full" onClick={() => navigate('/accounts')}
                  leadingIcon={<Link2 className="h-4 w-4" />}>
                  Link bank accounts for automatic updates
                </Button>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const canProceed = (() => {
    if (step === 0) return step1Valid;
    if (step === 1) return step2Valid;
    if (step === 2) return true;
    if (step === 3) return true;
    return false;
  })();

  if (initializing) {
    return (
      <div className="ui-root min-h-screen bg-canvas flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
      </div>
    );
  }

  return (
    <div className="ui-root min-h-screen bg-canvas flex flex-col text-content">
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
        {step < totalSteps - 1 && (
          <Eyebrow className="text-content-muted">Step {step + 1} of {totalSteps - 1}</Eyebrow>
        )}
      </header>

      {step < 4 && (
        <div className="relative px-6">
          <div className="mx-auto h-1.5 w-full max-w-[640px] overflow-hidden rounded-full bg-canvas-sunken">
            <motion.div className="h-full rounded-full bg-brand" initial={false}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} />
          </div>
        </div>
      )}

      <main className="relative flex-1 flex items-start justify-center overflow-y-auto px-4 py-8">
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

      {step < 4 && (
        <footer className="relative border-t border-line px-6 py-4">
          <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
            <div>
              {step > 0 && (
                <Button variant="ghost" onClick={goBack} leadingIcon={<ChevronLeft className="h-4 w-4" />}>
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {step === 3 && (
                <Button variant="ghost" onClick={goNext}>Skip for now</Button>
              )}
              <Button onClick={goNext} disabled={!canProceed || saving} loading={saving}
                trailingIcon={!saving ? <ChevronRight className="h-4 w-4" /> : undefined}>
                {step === 3 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function SummaryRow({ label, value, mono, capitalize }: {
  label: string; value: string; mono?: boolean; capitalize?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm text-content-muted">
      <span>{label}</span>
      <span className={cn('font-semibold text-content', mono && 'ui-tnum', capitalize && 'capitalize')}>{value}</span>
    </div>
  );
}
