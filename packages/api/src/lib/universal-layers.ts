import { type UserFinancialContext, type DebtBand } from './layer-selector.js';

// ── UniversalLayer ─────────────────────────────────────────────────────────────

export interface UniversalLayer {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  description: string;
  icon: string;
}

export const UNIVERSAL_LAYERS: UniversalLayer[] = [
  {
    id: 'stabilize',
    order: 1,
    name: 'Stabilize + oh-shit fund',
    subtitle: 'No defaults, no overdrafts, $1,000 liquid buffer',
    description:
      'Before anything else, stop financial bleeding: no missed payments, no overdraft fees, no accounts in collections. Then build a bare-minimum $1,000 cash buffer so a single emergency doesn\'t push you into high-interest debt.',
    icon: 'alert-circle',
  },
  {
    id: 'employer-match',
    order: 2,
    name: 'Employer match',
    subtitle: 'Capture the full 401(k) or ESPP match, a guaranteed 50 to 100% return',
    description:
      'Every paycheck without employer match capture is a permanent loss. A 100% match on 3% of salary is an instant double on those dollars. No investment comes close. Contribute at least enough to get the full match before any other investing.',
    icon: 'gift',
  },
  {
    id: 'high-rate-debt',
    order: 3,
    name: 'High-rate debt',
    subtitle: 'Eliminate all debt above 15% APR',
    description:
      'Credit card debt at 22%, payday loans at 400%, personal loans above 15%: these guaranteed losses exceed any expected investment return. Attack highest APR first (avalanche) or smallest balance first (snowball). Either beats minimums.',
    icon: 'flame',
  },
  {
    id: 'emergency-fund',
    order: 4,
    name: 'Emergency fund',
    subtitle: '3 to 6 months of essential expenses liquid (6 to 12 if self-employed)',
    description:
      'A fully funded emergency fund prevents job loss, medical bills, or major repairs from pushing you back into high-rate debt. Keep it in a high-yield savings account, accessible within 24 hours but not in your checking account.',
    icon: 'piggy-bank',
  },
  {
    id: 'insurance-will',
    order: 5,
    name: 'Insurance and will',
    subtitle: 'Term life, disability, will, beneficiary designations confirmed',
    description:
      'One uninsured event can reset your entire financial journey to layer 1. Term life costs $30 to $60/month and replaces your income for dependents. Disability insurance is even more likely to be needed: 1 in 4 workers are disabled before retirement. A will ensures your assets go where you intend.',
    icon: 'shield',
  },
  {
    id: 'tax-advantaged',
    order: 6,
    name: 'Tax-advantaged investing',
    subtitle: 'HSA, Roth IRA, 401(k) beyond match: active and growing',
    description:
      'Tax-advantaged account limits are annual and irrecoverable: miss a year and that space is gone forever. $7k in a Roth IRA at age 25 becomes ~$105k at 65 tax-free. HSA offers triple tax benefits. Start contributing before optimizing.',
    icon: 'sprout',
  },
  {
    id: 'mid-rate-debt',
    order: 7,
    name: 'Medium-rate debt',
    subtitle: 'Address all debt at 8 to 15% APR',
    description:
      'Debt in the 8 to 15% range is roughly break-even with expected market returns, but tax-advantaged contribution limits are use-it-or-lose-it while debt can be paid anytime. That asymmetry is why investing comes first. Now attack these balances.',
    icon: 'credit-card',
  },
  {
    id: 'max-contributions',
    order: 8,
    name: 'Max contributions',
    subtitle: 'All tax-advantaged accounts at or near annual limits',
    description:
      'Once medium-rate debt is handled, push every tax-advantaged account to its annual limit: 401(k) at $23,500 ($31k if 50+), Roth IRA at $7k ($8k if 50+), HSA at $4,300/$8,550. Every dollar in these accounts compounds with a structural tax advantage.',
    icon: 'trending-up',
  },
  {
    id: 'tax-optimization',
    order: 9,
    name: 'Tax optimization',
    subtitle: 'Tax-loss harvesting, asset location, Roth conversions',
    description:
      'With accounts funded, optimize how assets are held across account types. Asset location (tax-inefficient holdings in tax-advantaged accounts) adds 0.2 to 0.5% annually. Tax-loss harvesting offsets gains. Roth conversions in low-income years lock in lower rates.',
    icon: 'layers',
  },
  {
    id: 'low-interest-debt',
    order: 10,
    name: 'Low-interest debt',
    subtitle: 'Pay off remaining debt at or below 7% APR (mortgage, student loans, auto)',
    description:
      'Math says invest instead of accelerating these: expected market returns of 7 to 10% typically beat guaranteed 3 to 5% savings. The case for paying them off is behavioral: simplicity, security, and the psychological weight of carrying debt. Your call.',
    icon: 'credit-card',
  },
  {
    id: 'financial-independence',
    order: 11,
    name: 'Financial independence',
    subtitle: 'Portfolio sustains your lifestyle, so work is optional',
    description:
      'Financial independence means your investment portfolio generates enough to cover living expenses indefinitely, typically via the 4% rule (25x annual spending). At this point, work becomes a choice rather than a requirement.',
    icon: 'rocket',
  },
  {
    id: 'estate-legacy',
    order: 12,
    name: 'Estate and legacy',
    subtitle: 'Estate plan, trust, charitable strategy, generational wealth',
    description:
      'With financial independence secured, optimize for what outlasts you: a revocable trust avoids probate, donor-advised funds maximize charitable tax efficiency, and beneficiary designations ensure assets transfer as intended.',
    icon: 'landmark',
  },
];

// ── Debt buckets ───────────────────────────────────────────────────────────────

/**
 * The debt totals a UserFinancialContext carries. Bucket names are the context
 * field names, so a totals record spreads straight into the context.
 */
export const DEBT_BUCKETS = [
  'paydayLoanDebt',
  'creditCardDebt',
  'personalLoanHighDebt',
  'autoLoanHighDebt',
  'mediumInterestDebt',
  'autoLoanMedDebt',
  'personalLoanMedDebt',
  'federalStudentLoanDebt',
  'privateStudentLoanDebt',
  'autoLoanLowDebt',
  'studentLoanLowDebt',
  'mortgageBalance',
  'medicalDebt',
  'collectionsDebt',
] as const;

export type DebtBucket = (typeof DEBT_BUCKETS)[number];

/**
 * Which debt layer sums each bucket. Kept next to the layer totals below so a
 * bucket can never be counted toward a layer while its accounts are listed
 * under another. null = the bucket feeds no debt layer: `stabilize` reads
 * `collectionsDebt` on its own, and `federalStudentLoanDebt` and `medicalDebt`
 * are tracked but are not summed by any layer.
 */
export const DEBT_BAND_BY_BUCKET: Record<DebtBucket, DebtBand | null> = {
  paydayLoanDebt: 'high',
  creditCardDebt: 'high',
  personalLoanHighDebt: 'high',
  autoLoanHighDebt: 'high',
  mediumInterestDebt: 'mid',
  autoLoanMedDebt: 'mid',
  personalLoanMedDebt: 'mid',
  privateStudentLoanDebt: 'mid',
  mortgageBalance: 'low',
  autoLoanLowDebt: 'low',
  studentLoanLowDebt: 'low',
  federalStudentLoanDebt: null,
  medicalDebt: null,
  collectionsDebt: null,
};

/** Whole-word `auto`/`car`/`vehicle`: `car` is a substring of "credit card". */
const AUTO_WORDS = /\b(auto|car|vehicle)s?\b/;

/**
 * Which bucket a debt account's balance counts toward, from its type, its
 * subtype/name and its resolved APR. `apr` must be the rate resolved from the
 * account's liability metadata (see lib/debt-accounts.ts).
 *
 * A null APR means no rate is on file, never 0%. Banding an unrated account as
 * if it were interest-free is the dangerous direction to be wrong in, so each
 * branch falls back to the band its type is normally priced into: a card to
 * the credit-card bucket, an auto or personal loan to its medium band, a
 * private student loan to its own. That picks a band, it does not invent a
 * rate — the account still reports no rate everywhere one is shown. The
 * fallback applies to an UNKNOWN rate only: a rate on file always bands the
 * account, however low it is.
 */
export function classifyDebtBucket(account: {
  type: string;
  subtype: string | null;
  name: string;
  apr: number | null;
}): DebtBucket {
  const loanType = (account.subtype || account.name || '').toLowerCase();
  const rate = account.apr;

  if (loanType.includes('payday') || loanType.includes('bnpl')) return 'paydayLoanDebt';
  // Medical debt and collections belong to the stabilize layer whatever the
  // account's type is, so they are settled before the card branch below.
  if (loanType.includes('medical')) return 'medicalDebt';
  if (loanType.includes('collection')) return 'collectionsDebt';

  // Revolving credit is a card: never a mortgage, an auto loan or a student
  // loan. Deciding on the account's type before the name matchers keeps
  // Plaid's `credit card` subtype out of the auto branch and a store card like
  // "Home Depot" out of the `home` branch.
  //
  // `creditCardDebt` is the high band, and it is the fallback for a card with
  // NO rate on file, not a verdict on every card. A card that reports its rate
  // is banded by that rate on the same ladder every other type uses, so a 0%
  // promo balance is not presented as debt above 15% APR.
  if (account.type === 'credit') {
    if (rate == null) return 'creditCardDebt';
    return rate > 15 ? 'creditCardDebt' : 'mediumInterestDebt';
  }

  if (loanType.includes('student') || loanType.includes('sloan')) {
    const isFederal =
      loanType.includes('federal') || loanType.includes('direct') || loanType.includes('perkins');
    if (isFederal) return 'federalStudentLoanDebt';
    // Unrated: private student loans are priced like private loans, not like a
    // subsidized federal one, so they do not fall into the sub-5% bucket.
    return rate != null && rate < 5 ? 'studentLoanLowDebt' : 'privateStudentLoanDebt';
  }
  if (loanType.includes('mortgage') || loanType.includes('home')) return 'mortgageBalance';
  if (AUTO_WORDS.test(loanType)) {
    if (rate == null) return 'autoLoanMedDebt';
    return rate > 10 ? 'autoLoanHighDebt' : rate >= 6 ? 'autoLoanMedDebt' : 'autoLoanLowDebt';
  }
  if (rate == null) return 'personalLoanMedDebt';
  return rate > 15 ? 'personalLoanHighDebt' : rate >= 6 ? 'personalLoanMedDebt' : 'mediumInterestDebt';
}

// ── LayerAssessment ────────────────────────────────────────────────────────────

/** One named account behind a debt layer's total. */
export interface LayerDebtAccount {
  id: string;
  name: string;
  mask: string | null;
  balance: number;
  apr: number | null;
}

export interface LayerAssessment {
  status: 'complete' | 'in_progress' | 'not_started';
  progress: number; // 0–100
  current: number | null;
  target: number | null;
  action: string;
  /** The accounts making up `current`. Debt layers only. */
  accounts?: LayerDebtAccount[];
}

/**
 * The rate an account with none on file is RANKED at, per band: the rate its
 * band already assumes by holding it (see classifyDebtBucket).
 *
 * This is for ordering only and must never be displayed, returned or summed.
 * It is not a rate the account has, and a row with no rate on file still says
 * exactly that wherever the account is shown.
 */
const BAND_ASSUMED_APR: Record<DebtBand, number> = { high: 22, mid: 8, low: 4 };

/**
 * The band's accounts in payoff order: worst rate first, smallest balance
 * breaking a tie.
 *
 * An account with no rate on file ranks at the rate its band implies, so it
 * sits among the accounts it is being treated like instead of at one end of
 * the list. Sorting unrated accounts to the front let a $0 unrated card
 * outrank a 31% one and pushed the genuinely worst account behind the preview
 * cap; sorting them to the back, as if they were 0%, would contradict the band
 * they are in. `.filter()` returns a copy, so sorting it leaves the caller's
 * list in its own order.
 */
function debtAccountsInBand(ctx: UserFinancialContext, band: DebtBand): LayerDebtAccount[] {
  const assumed = BAND_ASSUMED_APR[band];
  return ctx.debtAccounts
    .filter((a) => a.band === band)
    .sort((a, b) => (b.apr ?? assumed) - (a.apr ?? assumed) || a.balance - b.balance)
    .map(({ id, name, mask, balance, apr }) => ({ id, name, mask, balance, apr }));
}

/**
 * The dollar figure a debt layer states. Every row under that figure is
 * rendered from its own rounded balance, so rounding the raw sum can leave the
 * headline a dollar away from the rows that make it up. Sum the rounded values
 * the rows show instead. Falls back to the band total when the layer lists no
 * accounts.
 *
 * This figure also decides whether the layer is done. Testing the raw total
 * instead left a band holding nothing but a residual balance (a 40-cent card)
 * reading "Pay off $0" over an empty list, with no way to ever clear it: the
 * headline said zero, the rows agreed, and only the completion test disagreed.
 */
function debtDollars(total: number, accounts: LayerDebtAccount[]): number {
  return accounts.length
    ? accounts.reduce((sum, a) => sum + Math.round(Math.abs(a.balance)), 0)
    : Math.round(total);
}

// ── assessLayer ────────────────────────────────────────────────────────────────

export function assessLayer(layerId: string, ctx: UserFinancialContext): LayerAssessment {
  switch (layerId) {
    case 'stabilize': {
      const hasCrisis = ctx.collectionsDebt > 0 || ctx.hasOverdraft;
      if (hasCrisis) {
        return {
          status: 'not_started',
          progress: 0,
          current: ctx.cashTotal,
          target: 1000,
          action: 'Resolve collections and overdraft first, then build $1,000 buffer.',
        };
      }
      const target = 1000;
      const current = ctx.cashTotal;
      if (current >= target) {
        return { status: 'complete', progress: 100, current, target, action: '' };
      }
      const progress = Math.min(99, Math.round((current / target) * 100));
      return {
        status: current > 0 ? 'in_progress' : 'not_started',
        progress,
        current,
        target,
        action: `Save $${(target - current).toLocaleString()} more to reach the $1,000 buffer.`,
      };
    }

    case 'employer-match': {
      if (ctx.employerMatchPct === 0) {
        return {
          status: 'complete',
          progress: 100,
          current: null,
          target: null,
          action: 'No employer match available.',
        };
      }
      if (ctx.trad401kBalance > 0) {
        return {
          status: 'in_progress',
          progress: 50,
          current: null,
          target: null,
          action: 'Verify you are contributing at least enough to capture the full employer match.',
        };
      }
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: 'Start contributing to your 401(k) to capture the employer match.',
      };
    }

    case 'high-rate-debt': {
      const current =
        ctx.creditCardDebt +
        ctx.paydayLoanDebt +
        ctx.personalLoanHighDebt +
        ctx.autoLoanHighDebt;
      const accounts = debtAccountsInBand(ctx, 'high');
      const dollars = debtDollars(current, accounts);
      if (dollars === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `Pay off $${dollars.toLocaleString()} in high-rate debt (above 15% APR).`,
        accounts,
      };
    }

    case 'emergency-fund': {
      const isSelfEmployed =
        ctx.employmentType === 'self_employed' || ctx.employmentType === '1099';
      const months = isSelfEmployed ? 9 : 6;
      // Prefer the stable trailing-average spend so the target doesn't drift day to day.
      const monthlySpend = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
      const expBase =
        monthlySpend !== null
          ? monthlySpend
          : ctx.annualIncome > 0
          ? (ctx.annualIncome / 12) * 0.7
          : 0;
      const target = expBase * months;

      if (target === 0) {
        return {
          status: 'not_started',
          progress: 0,
          current: ctx.cashTotal,
          target: 0,
          action: 'Set your monthly expenses or annual income to calculate your emergency fund target.',
        };
      }

      const current = ctx.cashTotal;
      if (current >= target) {
        return { status: 'complete', progress: 100, current, target, action: '' };
      }
      const progress = Math.min(99, Math.round((current / target) * 100));
      return {
        status: current > 0 ? 'in_progress' : 'not_started',
        progress,
        current,
        target,
        action: `Save $${(target - current).toLocaleString()} more to reach ${months} months of expenses.`,
      };
    }

    case 'insurance-will':
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: 'Review and mark complete when done.',
      };

    case 'tax-advantaged': {
      const combined = ctx.hsaBalance + ctx.rothIraBalance + ctx.trad401kBalance;
      if (combined > 0) {
        return {
          status: 'in_progress',
          progress: 50,
          current: null,
          target: null,
          action: 'Continue contributing to HSA, Roth IRA, and 401(k) accounts.',
        };
      }
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: 'Open and start contributing to tax-advantaged accounts (HSA, Roth IRA, 401(k)).',
      };
    }

    case 'mid-rate-debt': {
      const current =
        ctx.mediumInterestDebt +
        ctx.autoLoanMedDebt +
        ctx.personalLoanMedDebt +
        ctx.privateStudentLoanDebt;
      const accounts = debtAccountsInBand(ctx, 'mid');
      const dollars = debtDollars(current, accounts);
      if (dollars === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `Pay off $${dollars.toLocaleString()} in medium-rate debt (8 to 15% APR).`,
        accounts,
      };
    }

    case 'max-contributions': {
      const age = ctx.age ?? 0;
      const rothMax = age >= 50 ? 8000 : 7000;
      const k401Max = age >= 60 && age <= 63 ? 34750 : age >= 50 ? 31000 : 23500;
      const hsaCatchUp = age >= 55 ? 1000 : 0;
      const hsaMax = ctx.hasHDHP ? 4300 + hsaCatchUp : 0;
      const combinedTarget = rothMax + k401Max + hsaMax;

      const combined = ctx.rothIraBalance + ctx.trad401kBalance + (ctx.hasHDHP ? ctx.hsaBalance : 0);
      if (combined >= combinedTarget) {
        return {
          status: 'complete',
          progress: 100,
          current: combined,
          target: combinedTarget,
          action: '',
        };
      }
      const progress = combinedTarget > 0 ? Math.min(99, Math.round((combined / combinedTarget) * 100)) : 0;
      return {
        status: combined > 0 ? 'in_progress' : 'not_started',
        progress,
        current: combined,
        target: combinedTarget,
        action: `Max out contributions: target $${combinedTarget.toLocaleString()} across all tax-advantaged accounts.`,
      };
    }

    case 'tax-optimization':
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: 'Review and mark complete when done.',
      };

    case 'low-interest-debt': {
      const current = ctx.mortgageBalance + ctx.autoLoanLowDebt + ctx.studentLoanLowDebt;
      const accounts = debtAccountsInBand(ctx, 'low');
      const dollars = debtDollars(current, accounts);
      if (dollars === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `$${dollars.toLocaleString()} in low-interest debt remaining. Pay it off or invest instead, based on your preference.`,
        accounts,
      };
    }

    case 'financial-independence': {
      const annualExpenses =
        ctx.monthlyExpenses !== null
          ? ctx.monthlyExpenses * 12
          : ctx.annualIncome > 0
          ? ctx.annualIncome * 0.7
          : 0;
      const fiNumber = annualExpenses * 25;
      const totalInvested =
        ctx.rothIraBalance + ctx.trad401kBalance + ctx.brokerageBalance + ctx.hsaBalance;

      if (fiNumber === 0) {
        return {
          status: 'not_started',
          progress: 0,
          current: totalInvested,
          target: 0,
          action: 'Set monthly expenses or income to calculate your FI number.',
        };
      }

      if (totalInvested >= fiNumber) {
        return {
          status: 'complete',
          progress: 100,
          current: totalInvested,
          target: fiNumber,
          action: '',
        };
      }
      const progress = Math.min(99, Math.round((totalInvested / fiNumber) * 100));
      return {
        status: totalInvested > 0 ? 'in_progress' : 'not_started',
        progress,
        current: totalInvested,
        target: fiNumber,
        action: `Build portfolio to $${fiNumber.toLocaleString()} (25x annual expenses) for financial independence.`,
      };
    }

    case 'estate-legacy':
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: 'Review and mark complete when done.',
      };

    default:
      return {
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        action: '',
      };
  }
}
