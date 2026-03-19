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
} from 'lucide-react';
import { Logo } from '../components/common/Logo';
import { api } from '../lib/api';
import { cn, formatMoney } from '../lib/utils';

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
  { label: 'Checking / Savings', emoji: '\uD83D\uDCB5', type: 'depository', isDebt: false },
  { label: '401(k) / 403(b)', emoji: '\uD83D\uDCC8', type: 'investment', subtype: '401k', isDebt: false },
  { label: 'Roth IRA', emoji: '\uD83C\uDF31', type: 'investment', subtype: 'roth_ira', isDebt: false },
  { label: 'Traditional IRA', emoji: '\uD83D\uDCCA', type: 'investment', subtype: 'ira', isDebt: false },
  { label: 'Brokerage', emoji: '\uD83D\uDCBC', type: 'investment', subtype: 'brokerage', isDebt: false },
  { label: 'HSA', emoji: '\uD83C\uDFE5', type: 'investment', subtype: 'hsa', isDebt: false },
  { label: 'Primary Residence', emoji: '\uD83C\uDFE1', type: 'real_estate', subtype: 'primary', isDebt: false },
  { label: 'Rental Property', emoji: '\uD83C\uDFE2', type: 'real_estate', subtype: 'rental', isDebt: false },
  { label: 'Credit Card', emoji: '\uD83D\uDCB3', type: 'credit', isDebt: true },
  { label: 'Student Loan', emoji: '\uD83C\uDF93', type: 'loan', subtype: 'student', isDebt: true },
  { label: 'Auto Loan', emoji: '\uD83D\uDE97', type: 'loan', subtype: 'auto', isDebt: true },
  { label: 'Mortgage', emoji: '\uD83C\uDFE0', type: 'loan', subtype: 'mortgage', isDebt: true },
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

function CurrencyInput({ value, onChange, placeholder = '0', className = '' }: {
  value: string; onChange: (val: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        className="w-full bg-bg-elevated border border-border rounded-lg px-3 pl-7 py-2.5 text-text outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-text-secondary mt-1">{children}</p>;
}

export function Onboarding() {
  const [, navigate] = useLocation();
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
      api.getProfile().catch(() => null),
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getBalances().catch(() => ({ balances: [] })),
      api.getItems().catch(() => ({ items: [] })),
    ]).then(([profileData, fpData, balanceData, itemData]) => {
      const fp = fpData?.financialProfile;
      let startStep = 0;

      // Restore step 1 fields from DB
      if (profileData?.profile?.name) setName(profileData.profile.name);
      if (fp) {
        if (fp.dateOfBirth) setDob(fp.dateOfBirth.split('T')[0]);
        if (fp.filingStatus) setFilingStatus(fp.filingStatus);
        if (fp.stateOfResidence) setStateOfResidence(fp.stateOfResidence);

        // If profile basics exist, user completed step 1
        if (fp.filingStatus || fp.dateOfBirth) startStep = 1;

        // Restore step 2 fields
        if (fp.annualIncome) {
          setAnnualIncome(String(fp.annualIncome));
          if (fp.riskTolerance) setRiskTolerance(fp.riskTolerance);
          if (fp.retirementAge) setRetirementAge(String(fp.retirementAge));
          if (fp.employerMatchPercent !== null && fp.employerMatchPercent !== undefined) {
            setMatchPercent(String(fp.employerMatchPercent));
          }
          // If income + risk are set, user completed step 2
          if (fp.riskTolerance) startStep = 2;
        }

        if (fp.employmentType) setEmploymentType(fp.employmentType);
        if (fp.dependentCount !== null && fp.dependentCount !== undefined) setDependentCount(fp.dependentCount);
        if (fp.hasHDHP) setHasHDHP(fp.hasHDHP);
        if (fp.isPSLFEligible) setIsPSLFEligible(fp.isPSLFEligible);
      }

      // Check if accounts already exist (step 4)
      const hasAccounts = balanceData.balances.length > 0;
      const hasPlaid = itemData.items.some((i: { institutionId: string | null }) => i.institutionId && i.institutionId !== 'manual');
      if (hasPlaid) setLinkedViaPlaid(true);
      if (hasAccounts && startStep >= 3) startStep = 4; // go straight to completion

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
    if (step === 3) {
      localStorage.setItem('lasagna_onboarding_done', '1');
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, totalSteps - 1));
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
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Let&apos;s get to know you
              </h2>
              <p className="text-text-secondary text-sm">
                A few basics so we can personalize your projections and tax insights.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Your name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Alex" autoFocus
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors" />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Date of birth</label>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors [color-scheme:dark]" />
                <FieldHint>Used for age-based retirement projections and catch-up contribution eligibility (50+).</FieldHint>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Filing status</label>
                <select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors appearance-none">
                  <option value="">Select...</option>
                  {FILING_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <FieldHint>Determines tax bracket thresholds, Roth IRA income limits, and capital gains rates.</FieldHint>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">State of residence</label>
                <select value={stateOfResidence} onChange={(e) => setStateOfResidence(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors appearance-none">
                  <option value="">Select...</option>
                  {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <FieldHint>Some states have no income tax — this affects your take-home pay and retirement planning.</FieldHint>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Your income &amp; goals
              </h2>
              <p className="text-text-secondary text-sm">
                This drives your savings rate calculations, FIRE number, and retirement projections.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Annual gross income</label>
                <CurrencyInput value={annualIncome} onChange={setAnnualIncome} placeholder="75000" />
                <FieldHint>Used to calculate your savings rate, tax bracket, and how much to allocate to each financial layer.</FieldHint>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Employer 401(k) match</label>
                <div className="flex items-center gap-3 mb-2">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                    <input type="checkbox" checked={!has401k} onChange={(e) => setHas401k(!e.target.checked)} className="accent-accent w-4 h-4" />
                    I don&apos;t have a 401(k)
                  </label>
                </div>
                {has401k && (
                  <>
                    <div className="relative">
                      <input type="number" min={0} max={10} step={0.5} value={matchPercent} onChange={(e) => setMatchPercent(e.target.value)}
                        placeholder="3"
                        className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary">%</span>
                    </div>
                    <FieldHint>Not maxing your employer match is leaving free money on the table — we&apos;ll flag this.</FieldHint>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Risk tolerance</label>
                <div className="grid grid-cols-1 gap-2">
                  {RISK_LEVELS.map((r) => (
                    <button key={r.value} onClick={() => setRiskTolerance(r.value)}
                      className={cn(
                        'flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-all',
                        riskTolerance === r.value
                          ? 'border-accent bg-accent/5 text-text'
                          : 'border-border bg-bg-elevated text-text-secondary hover:border-border-light hover:text-text'
                      )}>
                      <span className="font-medium text-sm">{r.label}</span>
                      <span className="text-xs text-text-secondary">{r.desc}</span>
                    </button>
                  ))}
                </div>
                <FieldHint>Shapes your portfolio allocation suggestions and retirement simulation parameters.</FieldHint>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Target retirement age</label>
                <input type="number" min={30} max={80} value={retirementAge} onChange={(e) => setRetirementAge(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors" />
                <FieldHint>We&apos;ll project whether your current savings rate gets you there.</FieldHint>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Your situation
              </h2>
              <p className="text-text-secondary text-sm">
                Shapes which financial layers apply to you and in what order.
              </p>
            </div>

            <div className="space-y-5">
              {/* Employment type */}
              <div>
                <label className="block text-sm text-text-secondary mb-2">Employment type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'w2',             label: 'W2 employee' },
                    { value: 'self_employed',  label: 'Self-employed' },
                    { value: '1099',           label: '1099 / contractor' },
                    { value: 'business_owner', label: 'Business owner' },
                  ].map(opt => (
                    <button key={opt.value} type="button" onClick={() => setEmploymentType(opt.value)}
                      className={cn(
                        'px-3 py-2.5 rounded-lg border text-sm text-left transition-all',
                        employmentType === opt.value
                          ? 'border-accent bg-accent/5 text-text'
                          : 'border-border bg-bg-elevated text-text-secondary hover:border-border-light'
                      )}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-secondary mt-1.5">Determines which retirement accounts apply — 401(k), solo 401(k), SEP IRA, etc.</p>
              </div>

              {/* Dependents */}
              <div>
                <label className="block text-sm text-text-secondary mb-2">Number of dependents</label>
                <div className="flex items-center gap-2">
                  {[0, 1, 2, 3, 4].map(n => (
                    <button key={n} type="button" onClick={() => setDependentCount(n)}
                      className={cn(
                        'w-10 h-10 rounded-lg border text-sm font-medium transition-all',
                        dependentCount === n
                          ? 'border-accent bg-accent/5 text-text'
                          : 'border-border bg-bg-elevated text-text-secondary hover:border-border-light'
                      )}>
                      {n === 4 ? '4+' : n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-secondary mt-1.5">Surfaces life insurance, 529 savings, and dependent care FSA layers.</p>
              </div>

              {/* HDHP */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={hasHDHP} onChange={e => setHasHDHP(e.target.checked)}
                  className="accent-accent w-4 h-4 mt-0.5" />
                <div>
                  <p className="text-sm text-text">Enrolled in a high-deductible health plan (HDHP)</p>
                  <p className="text-xs text-text-secondary mt-0.5">Enables HSA contributions — the only account with triple tax advantages.</p>
                </div>
              </label>

              {/* PSLF */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={isPSLFEligible} onChange={e => setIsPSLFEligible(e.target.checked)}
                  className="accent-accent w-4 h-4 mt-0.5" />
                <div>
                  <p className="text-sm text-text">Work in public service (government or non-profit)</p>
                  <p className="text-xs text-text-secondary mt-0.5">May qualify for PSLF — changes your student loan strategy significantly.</p>
                </div>
              </label>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Connect your accounts
              </h2>
              <p className="text-text-secondary text-sm">
                Link your bank and investment accounts for automatic balance tracking, portfolio analysis, and spending insights.
              </p>
            </div>

            {/* Primary CTA: Link via Plaid */}
            <div className="bg-bg-elevated border border-accent/20 rounded-xl p-6 text-center">
              <Link2 className="w-10 h-10 text-accent mx-auto mb-3" />
              <h3 className="font-semibold text-lg mb-1">Link your accounts</h3>
              <p className="text-text-secondary text-sm mb-4 max-w-sm mx-auto">
                Securely connect via Plaid. Your balances and holdings update automatically so your projections stay current.
              </p>
              <button
                onClick={handleLinkPlaid}
                className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-bg rounded-xl font-semibold text-sm hover:bg-accent/90 transition-colors"
              >
                <Link2 className="w-4 h-4" />
                Link Bank Account
              </button>
              <p className="text-xs text-text-secondary mt-3">
                256-bit encryption. Read-only access. We never store your bank credentials.
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-text-secondary">or enter manually</span>
              <div className="flex-1 border-t border-border" />
            </div>

            {/* Manual entry toggle */}
            {!showManualEntry ? (
              <button
                onClick={() => setShowManualEntry(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border text-text-secondary text-sm hover:text-text hover:border-border-light transition-colors"
              >
                <PencilLine className="w-4 h-4" />
                Add accounts manually instead
              </button>
            ) : (
              <>
                {/* Added accounts */}
                {addedAccounts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-text-secondary uppercase tracking-wider">Added accounts</p>
                    {addedAccounts.map((acct) => (
                      <motion.div key={acct.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-between bg-bg-elevated border border-border rounded-lg px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-lg">{acct.emoji}</span>
                          <div>
                            <p className="text-sm font-medium text-text">{acct.name}</p>
                            <p className="text-xs text-text-secondary">{acct.type}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-text-secondary font-medium">{formatMoney(acct.balance, true)}</span>
                          <button onClick={() => handleRemoveAccount(acct.id)} className="text-text-secondary hover:text-danger transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Inline add form */}
                {activeType && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    className="bg-bg-elevated border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{activeType.emoji}</span>
                      <span className="text-sm font-medium text-text">{activeType.label}</span>
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Account name</label>
                      <input type="text" value={acctName} onChange={(e) => setAcctName(e.target.value)} autoFocus
                        className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors" />
                    </div>
                    <div>
                      <label className="block text-xs text-text-secondary mb-1">Balance</label>
                      <CurrencyInput value={acctBalance} onChange={setAcctBalance} className="text-sm" />
                    </div>
                    {activeType.isDebt && (
                      <div>
                        <label className="block text-xs text-text-secondary mb-1">Interest rate</label>
                        <div className="relative">
                          <input type="number" min={0} max={40} step={0.1} value={acctRate} onChange={(e) => setAcctRate(e.target.value)}
                            placeholder="5.5"
                            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">%</span>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={handleAddAccount} disabled={!acctName.trim() || addingAccount}
                        className="flex items-center gap-1.5 px-4 py-2 bg-accent text-bg rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
                        {addingAccount ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        Add
                      </button>
                      <button onClick={() => { setActiveType(null); setAcctName(''); setAcctBalance(''); setAcctRate(''); }}
                        className="px-4 py-2 text-text-secondary hover:text-text text-sm transition-colors">Cancel</button>
                    </div>
                  </motion.div>
                )}

                {/* Account type grid */}
                {!activeType && (
                  <div className="grid grid-cols-2 gap-2">
                    {ACCOUNT_TYPES.map((at) => (
                      <button key={at.label}
                        onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(''); setAcctRate(''); }}
                        className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-border bg-bg-elevated text-left hover:border-border-light hover:bg-surface-hover transition-all text-sm">
                        <span className="text-lg">{at.emoji}</span>
                        <span className="text-text-secondary font-medium">{at.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-xs text-text-secondary text-center">
                  Manual balances are a snapshot — consider linking accounts for automatic updates.
                </p>
              </>
            )}
          </div>
        );

      case 4:
        return (
          <div className="space-y-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="w-16 h-16 mx-auto rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center"
            >
              <Check className="w-8 h-8 text-accent" />
            </motion.div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                You&apos;re all set!
              </h2>
              <p className="text-text-secondary text-sm max-w-sm mx-auto">
                Your dashboard is ready. We&apos;ll use this information to personalize your projections and recommendations.
              </p>
            </div>

            <div className="bg-bg-elevated border border-border rounded-lg p-5 text-left space-y-3 max-w-sm mx-auto">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-2">Summary</p>
              {name && <div className="flex justify-between text-sm"><span className="text-text-secondary">Name</span><span className="text-text font-medium">{name}</span></div>}
              {annualIncome && <div className="flex justify-between text-sm"><span className="text-text-secondary">Income</span><span className="text-text font-medium">{formatMoney(parseFloat(annualIncome), true)}</span></div>}
              {employmentType && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-secondary">Employment</span>
                  <span className="text-text font-medium capitalize">{employmentType.replace(/_/g, ' ')}</span>
                </div>
              )}
              {riskTolerance && <div className="flex justify-between text-sm"><span className="text-text-secondary">Risk</span><span className="text-text font-medium capitalize">{riskTolerance.replace(/_/g, ' ')}</span></div>}
              {retirementAge && <div className="flex justify-between text-sm"><span className="text-text-secondary">Retire at</span><span className="text-text font-medium">{retirementAge}</span></div>}
              {addedAccounts.length > 0 && <div className="flex justify-between text-sm"><span className="text-text-secondary">Accounts</span><span className="text-text font-medium">{addedAccounts.length} added</span></div>}
              {linkedViaPlaid && <div className="flex justify-between text-sm"><span className="text-text-secondary">Bank</span><span className="text-accent font-medium">Linked via Plaid</span></div>}
            </div>

            <div className="space-y-3 pt-2">
              <button onClick={() => { localStorage.setItem('lasagna_onboarding_done', '1'); navigate('/', { replace: true }); }}
                className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-accent text-bg rounded-lg font-medium hover:bg-accent/90 transition-colors">
                Go to Dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
              {!linkedViaPlaid && (
                <button onClick={() => navigate('/accounts')}
                  className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-6 py-3 border border-border rounded-lg text-text-secondary text-sm hover:text-text hover:border-border-light transition-colors">
                  <Link2 className="w-4 h-4" />
                  Link bank accounts for automatic updates
                </button>
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
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Logo width={28} animate={false} />
          <span className="font-display text-lg font-medium text-text tracking-tight">Lasagna</span>
        </div>
        {step < totalSteps - 1 && <span className="text-xs text-text-secondary">Step {step + 1} of {totalSteps - 1}</span>}
      </div>

      {step < 4 && (
        <div className="px-6">
          <div className="w-full max-w-xl mx-auto h-1 bg-bg-elevated rounded-full overflow-hidden">
            <motion.div className="h-full bg-accent rounded-full" initial={false}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} />
          </div>
        </div>
      )}

      <div className="flex-1 flex items-start justify-center px-4 py-8 md:py-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div key={step} custom={direction} variants={slideVariants}
              initial="enter" animate="center" exit="exit"
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {step < 4 && (
        <div className="px-6 py-4 border-t border-border">
          <div className="w-full max-w-lg mx-auto flex items-center justify-between">
            <div>
              {step > 0 && (
                <button onClick={goBack} className="flex items-center gap-1 text-sm text-text-secondary hover:text-text transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {step === 3 && (
                <button onClick={goNext} className="text-sm text-text-secondary hover:text-text transition-colors">
                  Skip for now
                </button>
              )}
              <button onClick={goNext} disabled={!canProceed || saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-bg rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>{step === 3 ? 'Finish' : 'Next'}<ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
