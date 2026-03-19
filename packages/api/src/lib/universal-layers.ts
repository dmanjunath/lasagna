import { type UserFinancialContext } from './layer-selector.js';

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
    subtitle: 'Capture the full 401(k) or ESPP match — guaranteed 50–100% return',
    description:
      'Every paycheck without employer match capture is a permanent loss. A 100% match on 3% of salary is an instant double on those dollars — no investment comes close. Contribute at least enough to get the full match before any other investing.',
    icon: 'gift',
  },
  {
    id: 'high-rate-debt',
    order: 3,
    name: 'High-rate debt',
    subtitle: 'Eliminate all debt above 15% APR',
    description:
      'Credit card debt at 22%, payday loans at 400%, personal loans above 15% — these guaranteed losses exceed any expected investment return. Attack highest APR first (avalanche) or smallest balance first (snowball). Either beats minimums.',
    icon: 'flame',
  },
  {
    id: 'emergency-fund',
    order: 4,
    name: 'Emergency fund',
    subtitle: '3–6 months essential expenses liquid (6–12 if self-employed)',
    description:
      'A fully funded emergency fund prevents job loss, medical bills, or major repairs from pushing you back into high-rate debt. Keep it in a high-yield savings account — accessible within 24 hours but not in your checking account.',
    icon: 'piggy-bank',
  },
  {
    id: 'insurance-will',
    order: 5,
    name: 'Insurance and will',
    subtitle: 'Term life, disability, will, beneficiary designations confirmed',
    description:
      'One uninsured event can reset your entire financial journey to layer 1. Term life costs $30–60/month and replaces your income for dependents. Disability insurance is even more likely to be needed — 1 in 4 workers are disabled before retirement. A will ensures your assets go where you intend.',
    icon: 'shield',
  },
  {
    id: 'tax-advantaged',
    order: 6,
    name: 'Tax-advantaged investing',
    subtitle: 'HSA, Roth IRA, 401(k) beyond match — active and growing',
    description:
      'Tax-advantaged account limits are annual and irrecoverable — miss a year and that space is gone forever. $7k in a Roth IRA at age 25 becomes ~$105k at 65 tax-free. HSA offers triple tax benefits. Start contributing before optimizing.',
    icon: 'sprout',
  },
  {
    id: 'mid-rate-debt',
    order: 7,
    name: 'Medium-rate debt',
    subtitle: 'Address all debt 8–15% APR',
    description:
      'Debt in the 8–15% range is roughly break-even with expected market returns, but tax-advantaged contribution limits are use-it-or-lose-it while debt can be paid anytime. That asymmetry is why investing comes first. Now attack these balances.',
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
      'With accounts funded, optimize how assets are held across account types. Asset location (tax-inefficient holdings in tax-advantaged accounts) adds 0.2–0.5% annually. Tax-loss harvesting offsets gains. Roth conversions in low-income years lock in lower rates.',
    icon: 'layers',
  },
  {
    id: 'low-interest-debt',
    order: 10,
    name: 'Low-interest debt',
    subtitle: 'Pay off remaining debt ≤7% APR — mortgage, student loans, auto',
    description:
      'Math says invest instead of accelerating these — expected market returns of 7–10% typically beat guaranteed 3–5% savings. The case for paying them off is behavioral: simplicity, security, and the psychological weight of carrying debt. Your call.',
    icon: 'credit-card',
  },
  {
    id: 'financial-independence',
    order: 11,
    name: 'Financial independence',
    subtitle: 'Portfolio sustains your lifestyle — work is optional',
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

// ── LayerAssessment ────────────────────────────────────────────────────────────

export interface LayerAssessment {
  status: 'complete' | 'in_progress' | 'not_started';
  progress: number; // 0–100
  current: number | null;
  target: number | null;
  action: string;
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
          action: 'No employer match available — N/A.',
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
      if (current === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `Pay off $${current.toLocaleString()} in high-rate debt (above 15% APR).`,
      };
    }

    case 'emergency-fund': {
      const isSelfEmployed =
        ctx.employmentType === 'self_employed' || ctx.employmentType === '1099';
      const months = isSelfEmployed ? 9 : 6;
      const expBase =
        ctx.monthlyExpenses !== null
          ? ctx.monthlyExpenses
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
      if (current === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `Pay off $${current.toLocaleString()} in medium-rate debt (8–15% APR).`,
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
        action: `Max out contributions — target $${combinedTarget.toLocaleString()} across all tax-advantaged accounts.`,
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
      if (current === 0) {
        return { status: 'complete', progress: 100, current: 0, target: 0, action: '' };
      }
      return {
        status: 'in_progress',
        progress: 0,
        current,
        target: 0,
        action: `$${current.toLocaleString()} in low-interest debt remaining — pay off or invest instead based on your preference.`,
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
