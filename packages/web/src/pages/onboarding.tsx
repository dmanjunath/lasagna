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
import { Card, Button, Eyebrow, Pill } from '../components/ds';
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
    <div className={cn('ob-affix', className)}>
      <span className="ob-affix__sym ob-affix__sym--left">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        className="ob-input ds-num"
        style={{ paddingLeft: 28 }}
      />
    </div>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="ds-caption" style={{ marginTop: 6 }}>{children}</p>;
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
          <div className="ob-stack">
            <div className="ob-head">
              <h2 className="ds-h1">Let&apos;s get to know you</h2>
              <p className="ds-body ob-sub">
                A few basics so we can personalize your projections and tax insights.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/quick-import?from=onboarding')}
              className="ob-quick"
            >
              <div className="ob-quick__head">
                <span aria-hidden>✨</span>
                <span className="ob-quick__title">Quick Import — describe yourself instead</span>
              </div>
              <div className="ds-caption">
                Type a sentence or two and we&apos;ll fill out your profile and accounts.
              </div>
            </button>

            <div className="ob-fields">
              <div>
                <Eyebrow>Your name</Eyebrow>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Alex" autoFocus className="ob-input" style={{ marginTop: 8 }} />
              </div>

              <div>
                <Eyebrow>Date of birth</Eyebrow>
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                  className="ob-input" style={{ marginTop: 8 }} />
                <FieldHint>Used for age-based retirement projections and catch-up contribution eligibility (50+).</FieldHint>
              </div>

              <div>
                <Eyebrow>Filing status</Eyebrow>
                <select value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}
                  className="ob-input ob-select" style={{ marginTop: 8 }}>
                  <option value="">Select...</option>
                  {FILING_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <FieldHint>Determines tax bracket thresholds, Roth IRA income limits, and capital gains rates.</FieldHint>
              </div>

              <div>
                <Eyebrow>State of residence</Eyebrow>
                <select value={stateOfResidence} onChange={(e) => setStateOfResidence(e.target.value)}
                  className="ob-input ob-select" style={{ marginTop: 8 }}>
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
          <div className="ob-stack">
            <div className="ob-head">
              <h2 className="ds-h1">Your income &amp; goals</h2>
              <p className="ds-body ob-sub">
                This drives your savings rate calculations, FIRE number, and retirement projections.
              </p>
            </div>

            <div className="ob-fields">
              <div>
                <Eyebrow>Annual gross income</Eyebrow>
                <div style={{ marginTop: 8 }}>
                  <CurrencyInput value={annualIncome} onChange={setAnnualIncome} placeholder="75000" />
                </div>
                <FieldHint>Used to calculate your savings rate, tax bracket, and how much to allocate to each financial layer.</FieldHint>
              </div>

              <div>
                <Eyebrow>Employer 401(k) match</Eyebrow>
                <label className="ob-inline-check" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={!has401k} onChange={(e) => setHas401k(!e.target.checked)} className="ob-check" />
                  I don&apos;t have a 401(k)
                </label>
                {has401k && (
                  <>
                    <div className="ob-affix" style={{ marginTop: 10 }}>
                      <input type="number" min={0} max={10} step={0.5} value={matchPercent} onChange={(e) => setMatchPercent(e.target.value)}
                        placeholder="3" className="ob-input ds-num" style={{ paddingRight: 32 }} />
                      <span className="ob-affix__sym ob-affix__sym--right">%</span>
                    </div>
                    <FieldHint>Not maxing your employer match is leaving free money on the table — we&apos;ll flag this.</FieldHint>
                  </>
                )}
              </div>

              <div>
                <Eyebrow>Risk tolerance</Eyebrow>
                <div className="ob-chip-col" style={{ marginTop: 8 }}>
                  {RISK_LEVELS.map((r) => (
                    <button key={r.value} type="button" onClick={() => setRiskTolerance(r.value)}
                      className={cn('ob-chip', riskTolerance === r.value && 'ob-chip--active')}>
                      <span className="ob-chip__label">{r.label}</span>
                      <span className="ob-chip__meta">{r.desc}</span>
                    </button>
                  ))}
                </div>
                <FieldHint>Shapes your portfolio allocation suggestions and retirement simulation parameters.</FieldHint>
              </div>

              <div>
                <Eyebrow>Target retirement age</Eyebrow>
                <input type="number" min={30} max={80} value={retirementAge} onChange={(e) => setRetirementAge(e.target.value)}
                  className="ob-input ds-num" style={{ marginTop: 8 }} />
                <FieldHint>We&apos;ll project whether your current savings rate gets you there.</FieldHint>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="ob-stack">
            <div className="ob-head">
              <h2 className="ds-h1">Your situation</h2>
              <p className="ds-body ob-sub">
                Shapes which financial layers apply to you and in what order.
              </p>
            </div>

            <div className="ob-fields">
              {/* Employment type */}
              <div>
                <Eyebrow>Employment type</Eyebrow>
                <div className="ob-grid-2" style={{ marginTop: 8 }}>
                  {[
                    { value: 'w2',             label: 'W2 employee' },
                    { value: 'self_employed',  label: 'Self-employed' },
                    { value: '1099',           label: '1099 / contractor' },
                    { value: 'business_owner', label: 'Business owner' },
                  ].map(opt => (
                    <button key={opt.value} type="button" onClick={() => setEmploymentType(opt.value)}
                      className={cn('ob-chip', employmentType === opt.value && 'ob-chip--active')}>
                      <span className="ob-chip__label">{opt.label}</span>
                    </button>
                  ))}
                </div>
                <FieldHint>Determines which retirement accounts apply — 401(k), solo 401(k), SEP IRA, etc.</FieldHint>
              </div>

              {/* Dependents */}
              <div>
                <Eyebrow>Number of dependents</Eyebrow>
                <div className="ob-stepper" style={{ marginTop: 8 }}>
                  {[0, 1, 2, 3, 4].map(n => (
                    <button key={n} type="button" onClick={() => setDependentCount(n)}
                      className={cn('ob-step-num', dependentCount === n && 'ob-step-num--active')}>
                      {n === 4 ? '4+' : n}
                    </button>
                  ))}
                </div>
                <FieldHint>Surfaces life insurance, 529 savings, and dependent care FSA layers.</FieldHint>
              </div>

              {/* HDHP */}
              <label className="ob-check-row">
                <input type="checkbox" checked={hasHDHP} onChange={e => setHasHDHP(e.target.checked)}
                  className="ob-check" style={{ marginTop: 2 }} />
                <div>
                  <p className="ob-check-row__title">Enrolled in a high-deductible health plan (HDHP)</p>
                  <p className="ds-caption">Enables HSA contributions — the only account with triple tax advantages.</p>
                </div>
              </label>

              {/* PSLF */}
              <label className="ob-check-row">
                <input type="checkbox" checked={isPSLFEligible} onChange={e => setIsPSLFEligible(e.target.checked)}
                  className="ob-check" style={{ marginTop: 2 }} />
                <div>
                  <p className="ob-check-row__title">Work in public service (government or non-profit)</p>
                  <p className="ds-caption">May qualify for PSLF — changes your student loan strategy significantly.</p>
                </div>
              </label>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="ob-stack">
            <div className="ob-head">
              <h2 className="ds-h1">Connect your accounts</h2>
              <p className="ds-body ob-sub">
                Link your bank and investment accounts for automatic balance tracking, portfolio analysis, and spending insights.
              </p>
            </div>

            {/* Primary CTA: Link via Plaid */}
            <Card variant="cream" className="ob-link-cta">
              <Link2 className="ob-link-cta__icon" />
              <h3 className="ds-h2">Link your accounts</h3>
              <p className="ds-body ob-sub" style={{ maxWidth: '24rem', margin: '0 auto' }}>
                Securely connect via Plaid. Your balances and holdings update automatically so your projections stay current.
              </p>
              <Button variant="ink" onClick={handleLinkPlaid} icon={<Link2 className="ob-ico-14" />} style={{ marginTop: 4 }}>
                Link Bank Account
              </Button>
              <p className="ds-caption">
                256-bit encryption. Read-only access. We never store your bank credentials.
              </p>
            </Card>

            {/* Divider */}
            <div className="ds-rule-label"><Eyebrow>or enter manually</Eyebrow></div>

            {/* Manual entry toggle */}
            {!showManualEntry ? (
              <Button variant="ghost" onClick={() => setShowManualEntry(true)}
                icon={<PencilLine className="ob-ico-16" />} className="ob-btn-block">
                Add accounts manually instead
              </Button>
            ) : (
              <div className="ob-fields">
                {/* Added accounts */}
                {addedAccounts.length > 0 && (
                  <div className="ob-acct-list">
                    <Eyebrow>Added accounts</Eyebrow>
                    {addedAccounts.map((acct) => (
                      <motion.div key={acct.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        className="ob-acct-row">
                        <div className="ob-acct-row__main">
                          <span className="ob-emoji">{acct.emoji}</span>
                          <div>
                            <p className="ob-acct-row__name">{acct.name}</p>
                            <p className="ds-caption">{acct.type}</p>
                          </div>
                        </div>
                        <div className="ob-acct-row__end">
                          <span className="ob-acct-row__bal ds-num">{formatMoney(acct.balance, true)}</span>
                          <button onClick={() => handleRemoveAccount(acct.id)} className="ob-icon-btn" aria-label="Remove account">
                            <X className="ob-ico-16" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* Inline add form */}
                {activeType && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <Card variant="cream" className="ob-add-form">
                      <div className="ob-add-form__head">
                        <span className="ob-emoji">{activeType.emoji}</span>
                        <Pill tone="cream">{activeType.label}</Pill>
                      </div>
                      <div>
                        <Eyebrow>Account name</Eyebrow>
                        <input type="text" value={acctName} onChange={(e) => setAcctName(e.target.value)} autoFocus
                          className="ob-input" style={{ marginTop: 8 }} />
                      </div>
                      <div>
                        <Eyebrow>Balance</Eyebrow>
                        <div style={{ marginTop: 8 }}>
                          <CurrencyInput value={acctBalance} onChange={setAcctBalance} />
                        </div>
                      </div>
                      {activeType.isDebt && (
                        <div>
                          <Eyebrow>Interest rate</Eyebrow>
                          <div className="ob-affix" style={{ marginTop: 8 }}>
                            <input type="number" min={0} max={40} step={0.1} value={acctRate} onChange={(e) => setAcctRate(e.target.value)}
                              placeholder="5.5" className="ob-input ds-num" style={{ paddingRight: 32 }} />
                            <span className="ob-affix__sym ob-affix__sym--right">%</span>
                          </div>
                        </div>
                      )}
                      <div className="ob-add-form__actions">
                        <Button variant="ink" onClick={handleAddAccount} disabled={!acctName.trim() || addingAccount}
                          icon={addingAccount ? <Loader2 className="ob-ico-14 ob-spin" /> : <Plus className="ob-ico-14" />}>
                          Add
                        </Button>
                        <Button variant="ghost" onClick={() => { setActiveType(null); setAcctName(''); setAcctBalance(''); setAcctRate(''); }}>
                          Cancel
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                )}

                {/* Account type grid */}
                {!activeType && (
                  <div className="ob-grid-2">
                    {ACCOUNT_TYPES.map((at) => (
                      <button key={at.label}
                        onClick={() => { setActiveType(at); setAcctName(at.label); setAcctBalance(''); setAcctRate(''); }}
                        className="ob-type-tile">
                        <span className="ob-emoji">{at.emoji}</span>
                        <span className="ob-type-tile__label">{at.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <p className="ds-caption" style={{ textAlign: 'center' }}>
                  Manual balances are a snapshot — consider linking accounts for automatic updates.
                </p>
              </div>
            )}
          </div>
        );

      case 4:
        return (
          <div className="ob-stack ob-complete">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
              className="ob-done-badge"
            >
              <Check className="ob-ico-32" />
            </motion.div>

            <div className="ob-head ob-head--center">
              <h2 className="ds-h1">You&apos;re all set!</h2>
              <p className="ds-body ob-sub" style={{ maxWidth: '24rem', margin: '0 auto' }}>
                Your dashboard is ready. We&apos;ll use this information to personalize your projections and recommendations.
              </p>
            </div>

            <Card variant="cream" className="ob-summary">
              <Eyebrow>Summary</Eyebrow>
              {name && <div className="ob-summary__row"><span>Name</span><span className="ob-summary__val">{name}</span></div>}
              {annualIncome && <div className="ob-summary__row"><span>Income</span><span className="ob-summary__val ds-num">{formatMoney(parseFloat(annualIncome), true)}</span></div>}
              {employmentType && (
                <div className="ob-summary__row">
                  <span>Employment</span>
                  <span className="ob-summary__val" style={{ textTransform: 'capitalize' }}>{employmentType.replace(/_/g, ' ')}</span>
                </div>
              )}
              {riskTolerance && <div className="ob-summary__row"><span>Risk</span><span className="ob-summary__val" style={{ textTransform: 'capitalize' }}>{riskTolerance.replace(/_/g, ' ')}</span></div>}
              {retirementAge && <div className="ob-summary__row"><span>Retire at</span><span className="ob-summary__val ds-num">{retirementAge}</span></div>}
              {addedAccounts.length > 0 && <div className="ob-summary__row"><span>Accounts</span><span className="ob-summary__val">{addedAccounts.length} added</span></div>}
              {linkedViaPlaid && <div className="ob-summary__row"><span>Bank</span><span className="ob-summary__val" style={{ color: 'var(--lf-sauce)' }}>Linked via Plaid</span></div>}
            </Card>

            <div className="ob-complete__actions">
              <Button variant="ink" className="ob-btn-block"
                onClick={async () => { await api.updateOnboardingStage(null).catch(() => {}); setOnboardingStage(null); }}>
                Go to Dashboard
                <ChevronRight className="ob-ico-16" />
              </Button>
              {!linkedViaPlaid && (
                <Button variant="ghost" className="ob-btn-block" onClick={() => navigate('/accounts')}
                  icon={<Link2 className="ob-ico-16" />}>
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
      <div className="ob-shell ob-shell--center">
        <Loader2 className="ob-ico-24 ob-spin" style={{ color: 'var(--lf-muted)' }} />
        <ObStyles />
      </div>
    );
  }

  return (
    <div className="ob-shell">
      <header className="ob-topbar">
        <div className="ob-brand">
          <Logo width={28} animate={false} />
          <span className="lf-wordmark text-lg" style={{ color: 'var(--lf-ink)' }}>Lasagna<span className="fi">fi</span></span>
        </div>
        {step < totalSteps - 1 && (
          <Eyebrow>Step {step + 1} of {totalSteps - 1}</Eyebrow>
        )}
      </header>

      {step < 4 && (
        <div className="ob-progress-wrap">
          <div className="ob-progress">
            <motion.div className="ob-progress__fill" initial={false}
              animate={{ width: `${((step + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} />
          </div>
        </div>
      )}

      <main className="ob-main">
        <div className="ob-col">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div key={step} custom={direction} variants={slideVariants}
              initial="enter" animate="center" exit="exit"
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              <Card className="ob-card">{renderStep()}</Card>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {step < 4 && (
        <footer className="ob-footer">
          <div className="ob-footer__inner">
            <div>
              {step > 0 && (
                <Button variant="ghost" onClick={goBack} icon={<ChevronLeft className="ob-ico-16" />}>
                  Back
                </Button>
              )}
            </div>
            <div className="ob-footer__end">
              {step === 3 && (
                <Button variant="link" onClick={goNext}>Skip for now</Button>
              )}
              <Button variant="ink" onClick={goNext} disabled={!canProceed || saving}>
                {saving ? <Loader2 className="ob-ico-16 ob-spin" /> : <>{step === 3 ? 'Finish' : 'Next'}<ChevronRight className="ob-ico-16" /></>}
              </Button>
            </div>
          </div>
        </footer>
      )}
      <ObStyles />
    </div>
  );
}

function ObStyles() {
  return (
    <style>{`
      .ob-shell {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: var(--lf-cream);
      }
      .ob-shell--center { align-items: center; justify-content: center; }

      .ob-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 24px;
      }
      .ob-brand { display: flex; align-items: center; gap: 8px; }

      .ob-progress-wrap { padding: 0 24px; }
      .ob-progress {
        width: 100%; max-width: 640px; margin: 0 auto;
        height: 4px; border-radius: 999px; overflow: hidden;
        background: var(--lf-rule);
      }
      .ob-progress__fill { height: 100%; border-radius: 999px; background: var(--lf-ink); }

      .ob-main {
        flex: 1; display: flex; align-items: flex-start; justify-content: center;
        padding: 32px 16px; overflow-y: auto;
      }
      .ob-col { width: 100%; max-width: 540px; }
      .ob-card { padding: 28px; }

      .ob-stack { display: flex; flex-direction: column; gap: 24px; }
      .ob-head { display: flex; flex-direction: column; gap: 8px; }
      .ob-head--center { text-align: center; }
      .ob-sub { color: var(--lf-muted); }
      .ob-fields { display: flex; flex-direction: column; gap: 20px; }

      /* Inputs */
      .ob-input {
        width: 100%; padding: 12px 14px; min-height: 44px; box-sizing: border-box;
        background: var(--lf-paper);
        border: 1px solid var(--lf-rule); border-radius: 8px;
        font-size: 16px; font-family: 'Geist', system-ui, sans-serif;
        color: var(--lf-ink); outline: none;
        transition: border-color 0.12s, box-shadow 0.12s;
      }
      .ob-input:focus {
        border-color: var(--lf-ink);
        box-shadow: 0 0 0 3px var(--lf-rule-neutral);
      }
      .ob-input::placeholder { color: var(--lf-noodle); }
      .ob-select {
        appearance: none; -webkit-appearance: none;
        padding-right: 38px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
      }
      .ob-affix { position: relative; }
      .ob-affix__sym {
        position: absolute; top: 50%; transform: translateY(-50%);
        color: var(--lf-muted); font-size: 16px;
        font-family: 'JetBrains Mono', monospace;
        pointer-events: none;
      }
      .ob-affix__sym--left { left: 14px; }
      .ob-affix__sym--right { right: 14px; }

      /* Quick-import CTA */
      .ob-quick {
        display: block; width: 100%; text-align: left; cursor: pointer;
        padding: 16px; border-radius: 12px;
        background: var(--lf-cream);
        border: 1px solid var(--lf-cream-deep);
        transition: border-color 0.12s, background 0.12s;
      }
      .ob-quick:hover { border-color: var(--lf-sauce); }
      .ob-quick__head {
        display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
      }
      .ob-quick__title {
        font-family: 'Geist', system-ui, sans-serif;
        font-size: 14px; font-weight: 600; color: var(--lf-sauce);
      }

      /* Selection chips (risk, employment) */
      .ob-chip-col { display: flex; flex-direction: column; gap: 8px; }
      .ob-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ob-chip {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        width: 100%; min-height: 48px; padding: 12px 16px;
        border: 1px solid var(--lf-rule); border-radius: 8px;
        background: var(--lf-paper); color: var(--lf-ink-soft);
        font-family: 'Geist', system-ui, sans-serif; font-size: 14px;
        text-align: left; cursor: pointer;
        transition: border-color 0.12s, background 0.12s, color 0.12s;
      }
      .ob-chip:hover { background: var(--lf-cream); border-color: var(--lf-cream-deep); }
      .ob-chip--active {
        border-color: var(--lf-ink); background: var(--lf-cream); color: var(--lf-ink);
      }
      .ob-chip:focus-visible { outline: 2px solid var(--lf-sauce); outline-offset: 2px; }
      .ob-chip__label { font-weight: 600; }
      .ob-chip__meta { font-size: 12px; color: var(--lf-muted); }
      .ob-chip--active .ob-chip__meta { color: var(--lf-ink-soft); }

      /* Number stepper (dependents) */
      .ob-stepper { display: flex; align-items: center; gap: 8px; }
      .ob-step-num {
        width: 48px; height: 48px; border-radius: 8px;
        border: 1px solid var(--lf-rule); background: var(--lf-paper);
        color: var(--lf-ink-soft); font-weight: 600; font-size: 15px;
        font-family: 'Geist', system-ui, sans-serif; cursor: pointer;
        transition: border-color 0.12s, background 0.12s, color 0.12s;
      }
      .ob-step-num:hover { background: var(--lf-cream); border-color: var(--lf-cream-deep); }
      .ob-step-num--active {
        border-color: var(--lf-ink); background: var(--lf-ink); color: var(--lf-paper);
      }
      .ob-step-num:focus-visible { outline: 2px solid var(--lf-sauce); outline-offset: 2px; }

      /* Checkboxes */
      .ob-check {
        width: 18px; height: 18px; flex-shrink: 0;
        accent-color: var(--lf-sauce); cursor: pointer;
      }
      .ob-inline-check {
        display: flex; align-items: center; gap: 8px;
        font-family: 'Geist', system-ui, sans-serif; font-size: 14px;
        color: var(--lf-ink-soft); cursor: pointer; user-select: none;
        min-height: 44px;
      }
      .ob-check-row {
        display: flex; align-items: flex-start; gap: 12px;
        cursor: pointer; user-select: none;
      }
      .ob-check-row__title {
        font-family: 'Geist', system-ui, sans-serif; font-size: 14px;
        color: var(--lf-ink); margin: 0 0 2px;
      }

      /* Link CTA card */
      .ob-link-cta { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .ob-link-cta__icon { width: 36px; height: 36px; color: var(--lf-sauce); }

      /* Added account rows */
      .ob-acct-list { display: flex; flex-direction: column; gap: 8px; }
      .ob-acct-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 14px; border-radius: 10px;
        background: var(--lf-paper); border: 1px solid var(--lf-rule);
      }
      .ob-acct-row__main { display: flex; align-items: center; gap: 12px; }
      .ob-acct-row__name {
        font-family: 'Geist', system-ui, sans-serif; font-size: 14px;
        font-weight: 600; color: var(--lf-ink); margin: 0;
      }
      .ob-acct-row__end { display: flex; align-items: center; gap: 12px; }
      .ob-acct-row__bal { font-size: 14px; font-weight: 600; color: var(--lf-ink-soft); }
      .ob-emoji { font-size: 18px; line-height: 1; }

      /* Inline add form */
      .ob-add-form { display: flex; flex-direction: column; gap: 14px; }
      .ob-add-form__head { display: flex; align-items: center; gap: 10px; }
      .ob-add-form__actions { display: flex; gap: 8px; padding-top: 2px; }

      /* Account type tiles */
      .ob-type-tile {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px; min-height: 56px; border-radius: 10px;
        border: 1px solid var(--lf-rule); background: var(--lf-paper);
        text-align: left; cursor: pointer;
        font-family: 'Geist', system-ui, sans-serif; font-size: 13px;
        color: var(--lf-ink-soft); font-weight: 500;
        transition: background 0.12s, border-color 0.12s;
      }
      .ob-type-tile:hover { background: var(--lf-cream); border-color: var(--lf-cream-deep); }
      .ob-type-tile__label { line-height: 1.25; }

      .ob-icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 8px;
        color: var(--lf-muted); cursor: pointer;
        background: none; border: none; transition: color 0.12s, background 0.12s;
      }
      .ob-icon-btn:hover { color: var(--lf-neg); background: var(--lf-cream); }

      /* Complete step */
      .ob-complete { align-items: center; }
      .ob-done-badge {
        width: 64px; height: 64px; border-radius: 999px;
        display: flex; align-items: center; justify-content: center;
        background: var(--lf-cream); border: 1px solid var(--lf-cream-deep);
        color: var(--lf-sauce);
      }
      .ob-summary {
        width: 100%; max-width: 360px; text-align: left;
        display: flex; flex-direction: column; gap: 10px;
      }
      .ob-summary__row {
        display: flex; justify-content: space-between; align-items: baseline;
        font-family: 'Geist', system-ui, sans-serif; font-size: 14px;
        color: var(--lf-muted);
      }
      .ob-summary__val { color: var(--lf-ink); font-weight: 600; }
      .ob-complete__actions {
        width: 100%; max-width: 360px;
        display: flex; flex-direction: column; gap: 10px; padding-top: 4px;
      }

      /* Footer */
      .ob-footer { padding: 16px 24px; border-top: 1px solid var(--lf-rule); }
      .ob-footer__inner {
        width: 100%; max-width: 540px; margin: 0 auto;
        display: flex; align-items: center; justify-content: space-between;
      }
      .ob-footer__end { display: flex; align-items: center; gap: 12px; }

      .ob-btn-block { width: 100%; justify-content: center; }

      /* Icon sizing */
      .ob-ico-14 { width: 14px; height: 14px; }
      .ob-ico-16 { width: 16px; height: 16px; }
      .ob-ico-24 { width: 24px; height: 24px; }
      .ob-ico-32 { width: 32px; height: 32px; }
      .ob-spin { animation: ob-spin 0.8s linear infinite; }
      @keyframes ob-spin { to { transform: rotate(360deg); } }

      @media (max-width: 480px) {
        .ob-card { padding: 20px; }
        .ob-topbar { padding: 16px; }
        .ob-progress-wrap { padding: 0 16px; }
        .ob-footer { padding: 14px 16px; }
      }
    `}</style>
  );
}
