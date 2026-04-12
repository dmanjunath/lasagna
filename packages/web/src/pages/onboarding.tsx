import { useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  X,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { Logo } from '../components/common/Logo';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

// ─── US States ────────────────────────────────────────────
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

// ─── Account type definitions ─────────────────────────────
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
  { label: 'Credit Card', emoji: '\uD83D\uDCB3', type: 'credit', isDebt: true },
  { label: 'Student Loan', emoji: '\uD83C\uDF93', type: 'loan', subtype: 'student', isDebt: true },
  { label: 'Auto Loan', emoji: '\uD83D\uDE97', type: 'loan', subtype: 'auto', isDebt: true },
  { label: 'Mortgage', emoji: '\uD83C\uDFE0', type: 'loan', subtype: 'mortgage', isDebt: true },
];

const RISK_LEVELS = [
  { value: 'conservative', label: 'Conservative', desc: 'Preserve capital' },
  { value: 'moderately_conservative', label: 'Moderately Conservative', desc: 'Mostly stable' },
  { value: 'moderate', label: 'Moderate', desc: 'Balanced growth' },
  { value: 'moderately_aggressive', label: 'Moderately Aggressive', desc: 'Growth focused' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Maximum growth' },
];

const FILING_STATUSES = [
  'Single',
  'Married Filing Jointly',
  'Married Filing Separately',
  'Head of Household',
];

// ─── Added account representation ────────────────────────
interface AddedAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  emoji: string;
}

// ─── Slide animation variants ─────────────────────────────
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
};

// ─── Currency input helper ────────────────────────────────
function CurrencyInput({
  value,
  onChange,
  placeholder = '0',
  className = '',
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          onChange(raw);
        }}
        placeholder={placeholder}
        className="w-full bg-bg-elevated border border-border rounded-lg px-3 pl-7 py-2.5 text-text outline-none focus:border-accent transition-colors"
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────
export function Onboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1: Profile
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [filingStatus, setFilingStatus] = useState('');
  const [stateOfResidence, setStateOfResidence] = useState('');

  // Step 2: Income
  const [annualIncome, setAnnualIncome] = useState('');
  const [has401k, setHas401k] = useState(true);
  const [matchPercent, setMatchPercent] = useState('');
  const [riskTolerance, setRiskTolerance] = useState('');
  const [retirementAge, setRetirementAge] = useState('65');

  // Step 3: Accounts
  const [addedAccounts, setAddedAccounts] = useState<AddedAccount[]>([]);
  const [activeType, setActiveType] = useState<AccountTypeDef | null>(null);
  const [acctName, setAcctName] = useState('');
  const [acctBalance, setAcctBalance] = useState('');
  const [acctRate, setAcctRate] = useState('');
  const [addingAccount, setAddingAccount] = useState(false);

  const totalSteps = 4;

  // ─── Validation ───────────────────────────────────────
  const step1Valid = name.trim().length > 0;
  const step2Valid = annualIncome.trim().length > 0 && riskTolerance.length > 0;

  // ─── Navigation ───────────────────────────────────────
  const goNext = useCallback(async () => {
    setSaving(true);
    try {
      if (step === 0) {
        // Save profile
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
      }
      // Steps 2 and 3 don't need a batch save — accounts are saved inline
    } catch (err) {
      console.error('Failed to save onboarding step:', err);
    } finally {
      setSaving(false);
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, totalSteps - 1));
  }, [step, name, dob, filingStatus, stateOfResidence, annualIncome, has401k, matchPercent, riskTolerance, retirementAge]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  // ─── Account helpers ──────────────────────────────────
  const handleAddAccount = async () => {
    if (!activeType || !acctName.trim()) return;
    setAddingAccount(true);
    try {
      const balance = acctBalance ? parseFloat(acctBalance) : 0;
      const metadata: Record<string, unknown> = {};
      if (activeType.isDebt && acctRate) {
        metadata.interestRate = parseFloat(acctRate);
      }
      const result = await api.createManualAccount({
        name: acctName.trim(),
        type: activeType.type,
        subtype: activeType.subtype,
        balance,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });
      setAddedAccounts((prev) => [
        ...prev,
        {
          id: result.account.id,
          name: acctName.trim(),
          type: activeType.label,
          balance,
          emoji: activeType.emoji,
        },
      ]);
      // Reset form
      setActiveType(null);
      setAcctName('');
      setAcctBalance('');
      setAcctRate('');
    } catch (err) {
      console.error('Failed to create account:', err);
    } finally {
      setAddingAccount(false);
    }
  };

  const handleRemoveAccount = async (id: string) => {
    try {
      await api.deleteManualAccount(id);
      setAddedAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Failed to remove account:', err);
    }
  };

  // ─── Step content ─────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Let's get to know you
              </h2>
              <p className="text-text-secondary text-sm">
                A few basics so we can personalize your experience.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Your name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex"
                  autoFocus
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Date of birth</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors [color-scheme:dark]"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Filing status</label>
                <select
                  value={filingStatus}
                  onChange={(e) => setFilingStatus(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors appearance-none"
                >
                  <option value="">Select...</option>
                  {FILING_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">State of residence</label>
                <select
                  value={stateOfResidence}
                  onChange={(e) => setStateOfResidence(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors appearance-none"
                >
                  <option value="">Select...</option>
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Your income
              </h2>
              <p className="text-text-secondary text-sm">
                This helps us build a plan that fits your reality.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Annual gross income</label>
                <CurrencyInput
                  value={annualIncome}
                  onChange={setAnnualIncome}
                  placeholder="75000"
                />
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Employer 401(k) match</label>
                <div className="flex items-center gap-3 mb-2">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!has401k}
                      onChange={(e) => setHas401k(!e.target.checked)}
                      className="accent-accent w-4 h-4"
                    />
                    I don't have a 401(k)
                  </label>
                </div>
                {has401k && (
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      value={matchPercent}
                      onChange={(e) => setMatchPercent(e.target.value)}
                      placeholder="3"
                      className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">%</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Risk tolerance</label>
                <div className="grid grid-cols-1 gap-2">
                  {RISK_LEVELS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setRiskTolerance(r.value)}
                      className={cn(
                        'flex items-center justify-between px-4 py-3 rounded-lg border text-left transition-all',
                        riskTolerance === r.value
                          ? 'border-accent bg-accent-glow text-text'
                          : 'border-border bg-bg-elevated text-text-secondary hover:border-border-light hover:text-text'
                      )}
                    >
                      <span className="font-medium text-sm">{r.label}</span>
                      <span className="text-xs text-text-muted">{r.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1.5">Target retirement age</label>
                <input
                  type="number"
                  min={30}
                  max={80}
                  value={retirementAge}
                  onChange={(e) => setRetirementAge(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2.5 text-text outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                Your accounts
              </h2>
              <p className="text-text-secondary text-sm">
                Add your accounts so we can see the full picture. You can always add more later.
              </p>
            </div>

            {/* Link bank CTA */}
            <button
              onClick={() => navigate('/accounts')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border-accent bg-accent-glow text-accent text-sm font-medium hover:bg-accent/10 transition-colors"
            >
              <span>Link a bank account for automatic sync</span>
              <ExternalLink className="w-4 h-4" />
            </button>

            {/* Added accounts */}
            {addedAccounts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-muted uppercase tracking-wider">Added accounts</p>
                {addedAccounts.map((acct) => (
                  <motion.div
                    key={acct.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between bg-bg-elevated border border-border rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{acct.emoji}</span>
                      <div>
                        <p className="text-sm font-medium text-text">{acct.name}</p>
                        <p className="text-xs text-text-muted">{acct.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-text-secondary font-medium">
                        ${acct.balance.toLocaleString()}
                      </span>
                      <button
                        onClick={() => handleRemoveAccount(acct.id)}
                        className="text-text-muted hover:text-danger transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Inline add form */}
            {activeType && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-bg-elevated border border-border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{activeType.emoji}</span>
                  <span className="text-sm font-medium text-text">{activeType.label}</span>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Account name</label>
                  <input
                    type="text"
                    value={acctName}
                    onChange={(e) => setAcctName(e.target.value)}
                    autoFocus
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Balance</label>
                  <CurrencyInput value={acctBalance} onChange={setAcctBalance} className="text-sm" />
                </div>
                {activeType.isDebt && (
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Interest rate</label>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={40}
                        step={0.1}
                        value={acctRate}
                        onChange={(e) => setAcctRate(e.target.value)}
                        placeholder="5.5"
                        className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm text-text outline-none focus:border-accent transition-colors"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">%</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleAddAccount}
                    disabled={!acctName.trim() || addingAccount}
                    className="flex items-center gap-1.5 px-4 py-2 bg-accent text-bg rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent-dim transition-colors"
                  >
                    {addingAccount ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setActiveType(null);
                      setAcctName('');
                      setAcctBalance('');
                      setAcctRate('');
                    }}
                    className="px-4 py-2 text-text-muted hover:text-text text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}

            {/* Account type grid */}
            {!activeType && (
              <div className="grid grid-cols-2 gap-2">
                {ACCOUNT_TYPES.map((at) => (
                  <button
                    key={at.label}
                    onClick={() => {
                      setActiveType(at);
                      setAcctName(at.label);
                      setAcctBalance('');
                      setAcctRate('');
                    }}
                    className="flex items-center gap-2.5 px-3 py-3 rounded-lg border border-border bg-bg-elevated text-left hover:border-border-light hover:bg-surface-hover transition-all text-sm"
                  >
                    <span className="text-lg">{at.emoji}</span>
                    <span className="text-text-secondary font-medium">{at.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );

      case 3:
        return (
          <div className="space-y-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="w-16 h-16 mx-auto rounded-full bg-accent-glow border border-accent/30 flex items-center justify-center"
            >
              <Check className="w-8 h-8 text-accent" />
            </motion.div>

            <div>
              <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight mb-2">
                You're all set!
              </h2>
              <p className="text-text-secondary text-sm max-w-sm mx-auto">
                We have everything we need to get you started. Your dashboard is ready.
              </p>
            </div>

            {/* Summary */}
            <div className="bg-bg-elevated border border-border rounded-lg p-5 text-left space-y-3 max-w-sm mx-auto">
              <p className="text-xs text-text-muted uppercase tracking-wider mb-2">Summary</p>
              {name && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Name</span>
                  <span className="text-text font-medium">{name}</span>
                </div>
              )}
              {annualIncome && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Annual income</span>
                  <span className="text-text font-medium">${parseFloat(annualIncome).toLocaleString()}</span>
                </div>
              )}
              {riskTolerance && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Risk tolerance</span>
                  <span className="text-text font-medium capitalize">{riskTolerance.replace(/_/g, ' ')}</span>
                </div>
              )}
              {addedAccounts.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Accounts added</span>
                  <span className="text-text font-medium">{addedAccounts.length}</span>
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => navigate('/')}
                className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-accent text-bg rounded-lg font-medium hover:bg-accent-dim transition-colors"
              >
                Go to Dashboard
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate('/accounts')}
                className="w-full max-w-sm mx-auto flex items-center justify-center gap-2 px-6 py-3 border border-border rounded-lg text-text-secondary text-sm hover:text-text hover:border-border-light transition-colors"
              >
                Link bank accounts for automatic sync
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // ─── Can proceed? ─────────────────────────────────────
  const canProceed = (() => {
    if (step === 0) return step1Valid;
    if (step === 1) return step2Valid;
    if (step === 2) return true; // accounts are optional
    return false;
  })();

  // ─── Render ───────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Logo size={28} animate={false} />
          <span className="font-display text-lg font-medium text-text tracking-tight">Lasagna</span>
        </div>
        {step < 3 && (
          <span className="text-xs text-text-muted">
            Step {step + 1} of {totalSteps - 1}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {step < 3 && (
        <div className="px-6">
          <div className="w-full max-w-xl mx-auto h-1 bg-bg-elevated rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              initial={false}
              animate={{ width: `${((step + 1) / (totalSteps - 1)) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex items-start justify-center px-4 py-8 md:py-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Footer navigation */}
      {step < 3 && (
        <div className="px-6 py-4 border-t border-border">
          <div className="w-full max-w-lg mx-auto flex items-center justify-between">
            <div>
              {step > 0 && (
                <button
                  onClick={goBack}
                  className="flex items-center gap-1 text-sm text-text-muted hover:text-text transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {step === 2 && addedAccounts.length === 0 && (
                <button
                  onClick={goNext}
                  className="text-sm text-text-muted hover:text-text transition-colors"
                >
                  Skip for now
                </button>
              )}
              <button
                onClick={goNext}
                disabled={!canProceed || saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-bg rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent-dim transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {step === 2 ? 'Finish' : 'Next'}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
