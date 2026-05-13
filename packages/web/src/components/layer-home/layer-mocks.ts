// ── Layer Mock Data ───────────────────────────────────────────────────────────
//
// Provides realistic mock data for different user personas to validate the
// Layer Home Screen UI before backend wiring is complete.
//
// Personas:
//   - deepDebt:     Layers 1–3 active, high-rate debt crisis
//   - building:     Layers 6–8 active, wealth building phase
//   - mixed:        Layers 3 + 4, debt + emergency fund simultaneously
//   - fiReached:    Layer 11 complete, estate planning
//

import type { PriorityStep, PrioritySummary } from './types';

export interface MockPersona {
  name: string;
  steps: PriorityStep[];
  summary: PrioritySummary;
  debts: MockDebt[];
  insights: MockInsight[];
}

export interface MockDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  type: 'credit' | 'loan';
  subtype: string | null;
}

export interface MockInsight {
  id: string;
  layerId: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  actionText: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Personas ───────────────────────────────────────────────────────────────────

export const DEEP_DEBT_PERSONA: MockPersona = {
  name: 'Deep Debt User',
  steps: [
    {
      id: 'stabilize',
      order: 1,
      title: 'Stabilize + oh-shit fund',
      subtitle: 'No defaults, no overdrafts, $1,000 liquid buffer',
      description:
        'Before anything else, stop financial bleeding: no missed payments, no overdraft fees, no accounts in collections. Then build a bare-minimum $1,000 cash buffer.',
      icon: 'alert-circle',
      status: 'complete',
      skipped: false,
      current: 1200,
      target: 1000,
      progress: 100,
      action: 'Maintain $1,000 minimum checking buffer.',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'employer-match',
      order: 2,
      title: 'Employer match',
      subtitle: 'Capture the full 401(k) or ESPP match',
      description:
        'Every paycheck without employer match capture is a permanent loss. A 100% match on 3% of salary is an instant double.',
      icon: 'gift',
      status: 'complete',
      skipped: false,
      current: null,
      target: null,
      progress: 100,
      action: 'Contributing 6% to capture full 3% match.',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'high-rate-debt',
      order: 3,
      title: 'High-rate debt',
      subtitle: 'Eliminate all debt above 15% APR',
      description:
        'Credit card debt at 22%, payday loans at 400%, personal loans above 15% — these guaranteed losses exceed any expected investment return.',
      icon: 'flame',
      status: 'in_progress',
      skipped: false,
      current: 18750,
      target: 0,
      progress: 0,
      action: 'Pay off $18,750 in high-rate debt (above 15% APR).',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'emergency-fund',
      order: 4,
      title: 'Emergency fund',
      subtitle: '3–6 months essential expenses liquid',
      description:
        'A fully funded emergency fund prevents job loss, medical bills, or major repairs from pushing you back into high-rate debt.',
      icon: 'piggy-bank',
      status: 'in_progress',
      skipped: false,
      current: 1200,
      target: 10500,
      progress: 11,
      action: 'Save $9,300 more to reach 3 months of expenses ($10,500).',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'insurance-will',
      order: 5,
      title: 'Insurance and will',
      subtitle: 'Term life, disability, will, beneficiary designations',
      description: 'One uninsured event can reset your entire financial journey to layer 1.',
      icon: 'shield',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'tax-advantaged',
      order: 6,
      title: 'Tax-advantaged investing',
      subtitle: 'HSA, Roth IRA, 401(k) beyond match',
      description:
        'Tax-advantaged account limits are annual and irrecoverable — miss a year and that space is gone forever.',
      icon: 'sprout',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Open and start contributing to tax-advantaged accounts.',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'mid-rate-debt',
      order: 7,
      title: 'Medium-rate debt',
      subtitle: 'Address all debt 8–15% APR',
      description: 'Debt in the 8–15% range is roughly break-even with expected market returns.',
      icon: 'credit-card',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: '$6,200 in medium-rate debt remaining.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'max-contributions',
      order: 8,
      title: 'Max contributions',
      subtitle: 'All tax-advantaged accounts at or near annual limits',
      description: 'Push every tax-advantaged account to its annual limit.',
      icon: 'trending-up',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Max out contributions — target $30,500 across all accounts.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'tax-optimization',
      order: 9,
      title: 'Tax optimization',
      subtitle: 'Tax-loss harvesting, asset location, Roth conversions',
      description: 'Optimize how assets are held across account types.',
      icon: 'layers',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'low-interest-debt',
      order: 10,
      title: 'Low-interest debt',
      subtitle: 'Pay off remaining debt ≤7% APR',
      description: 'Math says invest instead of accelerating these.',
      icon: 'credit-card',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: '$142,000 in low-interest debt remaining.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'financial-independence',
      order: 11,
      title: 'Financial independence',
      subtitle: 'Portfolio sustains your lifestyle — work is optional',
      description: 'Your investment portfolio generates enough to cover living expenses indefinitely.',
      icon: 'rocket',
      status: 'not_started',
      skipped: false,
      current: 3500,
      target: 787500,
      progress: 0,
      action: 'Build portfolio to $787,500 (25x annual expenses).',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'estate-legacy',
      order: 12,
      title: 'Estate and legacy',
      subtitle: 'Estate plan, trust, charitable strategy',
      description: 'Optimize for what outlasts you.',
      icon: 'landmark',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
  ],
  summary: {
    monthlyIncome: 4200,
    monthlyExpenses: 3500,
    monthlySurplus: 700,
    totalCash: 1200,
    totalInvested: 3500,
    totalHighInterestDebt: 18750,
    totalMediumInterestDebt: 6200,
    age: 28,
    retirementAge: 60,
    filingStatus: 'single',
  },
  debts: [
    { id: 'd1', name: 'Chase Sapphire', balance: 8200, apr: 24.99, minPayment: 246, type: 'credit', subtype: null },
    { id: 'd2', name: 'Amex Gold', balance: 5400, apr: 22.74, minPayment: 162, type: 'credit', subtype: null },
    { id: 'd3', name: 'Discover It', balance: 3150, apr: 19.99, minPayment: 95, type: 'credit', subtype: null },
    { id: 'd4', name: 'SoFi Personal Loan', balance: 6200, apr: 11.5, minPayment: 210, type: 'loan', subtype: 'personal_loan' },
    { id: 'd5', name: 'Federal Student Loans', balance: 28000, apr: 4.99, minPayment: 298, type: 'loan', subtype: 'student_loan' },
  ],
  insights: [
    {
      id: 'i1',
      layerId: 'high-rate-debt',
      urgency: 'critical',
      title: 'Chase Sapphire is bleeding $171/mo in interest',
      description: 'At 24.99% APR, your $8,200 balance costs $171 every month in interest alone. Paying the minimum keeps you in debt for 4+ years.',
      impact: '$2,100 saved in interest',
      actionText: 'Pay $400/mo to Chase card → debt-free by Oct 2027',
    },
    {
      id: 'i2',
      layerId: 'high-rate-debt',
      urgency: 'high',
      title: 'Avalanche saves $890 vs snowball',
      description: 'Paying highest APR first (Chase → Amex → Discover) saves $890 in total interest compared to smallest-balance-first.',
      impact: '$890 saved',
      actionText: 'Switch to avalanche payoff order',
    },
    {
      id: 'i3',
      layerId: 'emergency-fund',
      urgency: 'high',
      title: 'Emergency fund only covers 10 days',
      description: 'With $1,200 cash and $3,500/mo essential expenses, you have 10 days of buffer. A single emergency puts you back on the credit cards.',
      impact: 'Prevents $5,000+ emergency debt',
      actionText: 'Build emergency fund to $10,500 (3 months)',
    },
    {
      id: 'i4',
      layerId: 'high-rate-debt',
      urgency: 'medium',
      title: 'Balance transfer could save $1,400',
      description: 'Your credit score (estimated 680) may qualify for 0% balance transfer cards. Moving $8,200 saves ~$1,400 in interest over 18 months.',
      impact: '$1,400 saved',
      actionText: 'Explore 0% balance transfer options',
    },
    {
      id: 'i5',
      layerId: 'employer-match',
      urgency: 'low',
      title: 'You are capturing full employer match',
      description: 'Contributing 6% to get the 3% full match. Good — this is a 100% instant return. Keep it up while attacking high-rate debt.',
      impact: '$2,520/yr match captured',
      actionText: 'Maintain 6% contribution',
    },
  ],
};

export const BUILDING_WEALTH_PERSONA: MockPersona = {
  name: 'Wealth Builder',
  steps: [
    {
      id: 'stabilize',
      order: 1,
      title: 'Stabilize + oh-shit fund',
      subtitle: 'No defaults, no overdrafts, $1,000 liquid buffer',
      description: 'Stop financial bleeding.',
      icon: 'alert-circle',
      status: 'complete',
      skipped: false,
      current: 1200,
      target: 1000,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'employer-match',
      order: 2,
      title: 'Employer match',
      subtitle: 'Capture the full 401(k) or ESPP match',
      description: 'Instant double on those dollars.',
      icon: 'gift',
      status: 'complete',
      skipped: false,
      current: null,
      target: null,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'high-rate-debt',
      order: 3,
      title: 'High-rate debt',
      subtitle: 'Eliminate all debt above 15% APR',
      description: 'Credit cards, payday loans.',
      icon: 'flame',
      status: 'complete',
      skipped: false,
      current: 0,
      target: 0,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'emergency-fund',
      order: 4,
      title: 'Emergency fund',
      subtitle: '3–6 months essential expenses liquid',
      description: 'Fully funded emergency buffer.',
      icon: 'piggy-bank',
      status: 'complete',
      skipped: false,
      current: 21000,
      target: 21000,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'insurance-will',
      order: 5,
      title: 'Insurance and will',
      subtitle: 'Term life, disability, will, beneficiary designations',
      description: 'Protect against uninsured events.',
      icon: 'shield',
      status: 'complete',
      skipped: false,
      current: null,
      target: null,
      progress: 100,
      action: '',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'tax-advantaged',
      order: 6,
      title: 'Tax-advantaged investing',
      subtitle: 'HSA, Roth IRA, 401(k) beyond match',
      description: 'Annual irrecoverable space.',
      icon: 'sprout',
      status: 'in_progress',
      skipped: false,
      current: 45000,
      target: null,
      progress: 60,
      action: 'Continue contributing to HSA, Roth IRA, and 401(k).',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'mid-rate-debt',
      order: 7,
      title: 'Medium-rate debt',
      subtitle: 'Address all debt 8–15% APR',
      description: 'Break-even with market returns.',
      icon: 'credit-card',
      status: 'complete',
      skipped: false,
      current: 0,
      target: 0,
      progress: 100,
      action: '',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'max-contributions',
      order: 8,
      title: 'Max contributions',
      subtitle: 'All tax-advantaged accounts at or near annual limits',
      description: 'Push every account to limit.',
      icon: 'trending-up',
      status: 'in_progress',
      skipped: false,
      current: 18500,
      target: 30500,
      progress: 61,
      action: 'Max out contributions — target $30,500. You are $12,000 short.',
      detail: '',
      priority: 'high',
      note: '',
    },
    {
      id: 'tax-optimization',
      order: 9,
      title: 'Tax optimization',
      subtitle: 'Tax-loss harvesting, asset location, Roth conversions',
      description: 'Optimize how assets are held.',
      icon: 'layers',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'low-interest-debt',
      order: 10,
      title: 'Low-interest debt',
      subtitle: 'Pay off remaining debt ≤7% APR',
      description: 'Mortgage, student loans.',
      icon: 'credit-card',
      status: 'in_progress',
      skipped: false,
      current: 245000,
      target: 0,
      progress: 15,
      action: '$245,000 in low-interest debt remaining — pay off or invest.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'financial-independence',
      order: 11,
      title: 'Financial independence',
      subtitle: 'Portfolio sustains your lifestyle',
      description: '25x annual expenses.',
      icon: 'rocket',
      status: 'in_progress',
      skipped: false,
      current: 312000,
      target: 1575000,
      progress: 20,
      action: 'Build portfolio to $1,575,000 (25x annual expenses).',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'estate-legacy',
      order: 12,
      title: 'Estate and legacy',
      subtitle: 'Estate plan, trust, charitable strategy',
      description: 'Optimize for what outlasts you.',
      icon: 'landmark',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
  ],
  summary: {
    monthlyIncome: 10500,
    monthlyExpenses: 5250,
    monthlySurplus: 5250,
    totalCash: 21000,
    totalInvested: 312000,
    totalHighInterestDebt: 0,
    totalMediumInterestDebt: 0,
    age: 34,
    retirementAge: 50,
    filingStatus: 'married_filing_jointly',
  },
  debts: [
    { id: 'd1', name: 'Mortgage', balance: 245000, apr: 3.25, minPayment: 1450, type: 'loan', subtype: 'mortgage' },
  ],
  insights: [
    {
      id: 'i1',
      layerId: 'max-contributions',
      urgency: 'high',
      title: 'You are leaving $12,000 of tax-advantaged space on the table',
      description: 'Your 401(k) + Roth IRA + HSA could take $30,500 this year. You have contributed $18,500. That missing $12,000 costs ~$180,000 by age 60.',
      impact: '$180,000 future value',
      actionText: 'Increase 401(k) by $500/mo and max Roth IRA',
    },
    {
      id: 'i2',
      layerId: 'tax-optimization',
      urgency: 'medium',
      title: 'VFINX → VOO saves $340/yr in fees',
      description: 'Your taxable brokerage holds VFINX (0.14% ER). Switching to VOO (0.03%) on the same $340,000 balance saves $340/yr with identical exposure.',
      impact: '$340/yr saved',
      actionText: 'Sell VFINX, buy VOO in taxable account',
    },
    {
      id: 'i3',
      layerId: 'tax-optimization',
      urgency: 'medium',
      title: '$4,200 in unrealized losses available for harvesting',
      description: 'Your taxable account shows $4,200 in unrealized losses. Harvesting these offsets capital gains and up to $3,000 of ordinary income.',
      impact: '$1,200+ tax savings',
      actionText: 'Harvest losses in taxable brokerage',
    },
    {
      id: 'i4',
      layerId: 'financial-independence',
      urgency: 'low',
      title: 'FI date: August 2047 at current pace',
      description: 'With $5,250/mo surplus and 32% savings rate, you reach 25x expenses around August 2047. Increasing savings rate to 40% pulls it to March 2044.',
      impact: '-3.5 years to FI',
      actionText: 'Run retirement simulation →',
    },
    {
      id: 'i5',
      layerId: 'low-interest-debt',
      urgency: 'low',
      title: 'Mortgage at 3.25% — invest instead?',
      description: 'Your mortgage rate (3.25%) is below expected market returns. Every extra $1,000 toward investments instead of mortgage yields ~$70/yr more over 20 years.',
      impact: '$70/yr per $1,000 redirected',
      actionText: 'Redirect extra payments to brokerage',
    },
  ],
};

export const MIXED_PERSONA: MockPersona = {
  name: 'Mixed User',
  steps: [
    {
      id: 'stabilize',
      order: 1,
      title: 'Stabilize + oh-shit fund',
      subtitle: 'No defaults, no overdrafts, $1,000 liquid buffer',
      description: 'Stop financial bleeding.',
      icon: 'alert-circle',
      status: 'complete',
      skipped: false,
      current: 2500,
      target: 1000,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'employer-match',
      order: 2,
      title: 'Employer match',
      subtitle: 'Capture the full 401(k) or ESPP match',
      description: 'Instant double.',
      icon: 'gift',
      status: 'complete',
      skipped: false,
      current: null,
      target: null,
      progress: 100,
      action: '',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'high-rate-debt',
      order: 3,
      title: 'High-rate debt',
      subtitle: 'Eliminate all debt above 15% APR',
      description: 'Guaranteed losses exceed market returns.',
      icon: 'flame',
      status: 'in_progress',
      skipped: false,
      current: 4200,
      target: 0,
      progress: 35,
      action: 'Pay off $4,200 in high-rate debt (above 15% APR).',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'emergency-fund',
      order: 4,
      title: 'Emergency fund',
      subtitle: '3–6 months essential expenses liquid',
      description: 'Prevents backslide into high-rate debt.',
      icon: 'piggy-bank',
      status: 'in_progress',
      skipped: false,
      current: 8500,
      target: 12000,
      progress: 71,
      action: 'Save $3,500 more to reach 3 months of expenses ($12,000).',
      detail: '',
      priority: 'critical',
      note: '',
    },
    {
      id: 'insurance-will',
      order: 5,
      title: 'Insurance and will',
      subtitle: 'Term life, disability, will, beneficiary designations',
      description: 'Protect dependents.',
      icon: 'shield',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'tax-advantaged',
      order: 6,
      title: 'Tax-advantaged investing',
      subtitle: 'HSA, Roth IRA, 401(k) beyond match',
      description: 'Annual irrecoverable space.',
      icon: 'sprout',
      status: 'in_progress',
      skipped: false,
      current: 12000,
      target: null,
      progress: 40,
      action: 'Continue contributing to HSA, Roth IRA, and 401(k).',
      detail: '',
      priority: 'medium',
      note: '',
    },
    {
      id: 'mid-rate-debt',
      order: 7,
      title: 'Medium-rate debt',
      subtitle: 'Address all debt 8–15% APR',
      description: 'Break-even with market.',
      icon: 'credit-card',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'No medium-rate debt remaining.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'max-contributions',
      order: 8,
      title: 'Max contributions',
      subtitle: 'All tax-advantaged accounts at or near annual limits',
      description: 'Push to limits.',
      icon: 'trending-up',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Max out contributions — target $30,500.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'tax-optimization',
      order: 9,
      title: 'Tax optimization',
      subtitle: 'Tax-loss harvesting, asset location, Roth conversions',
      description: 'Optimize holdings.',
      icon: 'layers',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'low-interest-debt',
      order: 10,
      title: 'Low-interest debt',
      subtitle: 'Pay off remaining debt ≤7% APR',
      description: 'Invest vs pay off.',
      icon: 'credit-card',
      status: 'in_progress',
      skipped: false,
      current: 18500,
      target: 0,
      progress: 45,
      action: '$18,500 in low-interest debt remaining.',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'financial-independence',
      order: 11,
      title: 'Financial independence',
      subtitle: 'Portfolio sustains your lifestyle',
      description: '25x expenses.',
      icon: 'rocket',
      status: 'in_progress',
      skipped: false,
      current: 18000,
      target: 900000,
      progress: 2,
      action: 'Build portfolio to $900,000 (25x annual expenses).',
      detail: '',
      priority: 'low',
      note: '',
    },
    {
      id: 'estate-legacy',
      order: 12,
      title: 'Estate and legacy',
      subtitle: 'Estate plan, trust, charitable strategy',
      description: 'What outlasts you.',
      icon: 'landmark',
      status: 'not_started',
      skipped: false,
      current: null,
      target: null,
      progress: 0,
      action: 'Review and mark complete when done.',
      detail: '',
      priority: 'low',
      note: '',
    },
  ],
  summary: {
    monthlyIncome: 5500,
    monthlyExpenses: 4000,
    monthlySurplus: 1500,
    totalCash: 8500,
    totalInvested: 18000,
    totalHighInterestDebt: 4200,
    totalMediumInterestDebt: 0,
    age: 30,
    retirementAge: 55,
    filingStatus: 'single',
  },
  debts: [
    { id: 'd1', name: 'Capital One Venture', balance: 4200, apr: 21.99, minPayment: 126, type: 'credit', subtype: null },
    { id: 'd2', name: 'Car Loan', balance: 18500, apr: 4.5, minPayment: 340, type: 'loan', subtype: 'auto' },
  ],
  insights: [
    {
      id: 'i1',
      layerId: 'high-rate-debt',
      urgency: 'critical',
      title: 'Capital One costs $77/mo in interest',
      description: 'At 21.99% APR, your $4,200 balance bleeds $77/month. Paying it off in 6 months frees up $400/mo for your emergency fund.',
      impact: '$462 saved in interest',
      actionText: 'Pay $700/mo → debt-free in 6 months',
    },
    {
      id: 'i2',
      layerId: 'emergency-fund',
      urgency: 'high',
      title: 'Emergency fund 71% complete',
      description: 'You are $3,500 away from a full 3-month emergency fund. Once the credit card is gone, redirect that $700/mo here.',
      impact: 'Prevents backslide into 22% debt',
      actionText: 'Redirect credit card payment to EF',
    },
    {
      id: 'i3',
      layerId: 'tax-advantaged',
      urgency: 'medium',
      title: 'Roth IRA has $4,500 of space left',
      description: 'You have contributed $2,500 of the $7,000 Roth IRA limit. You have 4 months to max it — $625/mo.',
      impact: '$70,000+ future value',
      actionText: 'Increase Roth contribution by $300/mo',
    },
  ],
};

// ── Selector ──────────────────────────────────────────────────────────────────

export const ALL_PERSONAS: Record<string, MockPersona> = {
  deepDebt: DEEP_DEBT_PERSONA,
  building: BUILDING_WEALTH_PERSONA,
  mixed: MIXED_PERSONA,
};

export function getMockPersona(key: string): MockPersona | null {
  return ALL_PERSONAS[key] ?? null;
}

export function getDefaultMockPersona(): MockPersona {
  return DEEP_DEBT_PERSONA;
}

// ── Layer helpers ─────────────────────────────────────────────────────────────

export function getPrimaryLayer(steps: PriorityStep[]): PriorityStep | null {
  return steps.find((s) => s.status !== 'complete' && !s.skipped) ?? null;
}

export function getSecondaryLayers(steps: PriorityStep[]): PriorityStep[] {
  const primary = getPrimaryLayer(steps);
  return steps.filter(
    (s) =>
      s.status !== 'complete' &&
      !s.skipped &&
      s.id !== primary?.id
  );
}

export function isDebtUser(steps: PriorityStep[]): boolean {
  const primary = getPrimaryLayer(steps);
  if (!primary) return false;
  return primary.order <= 5;
}

export function isFireUser(steps: PriorityStep[]): boolean {
  const primary = getPrimaryLayer(steps);
  if (!primary) return false;
  return primary.order >= 6;
}

export function getNextLayer(steps: PriorityStep[], currentId: string): PriorityStep | null {
  const currentOrder = steps.find((s) => s.id === currentId)?.order ?? 0;
  return steps.find((s) => s.order > currentOrder && s.status !== 'complete' && !s.skipped) ?? null;
}

// ── Debt cascade math ─────────────────────────────────────────────────────────

export interface CascadeDebt extends MockDebt {
  suggestedPayment: number;
  monthsToPayoff: number;
  totalInterest: number;
  payoffDate: Date;
  rolledOverAmount: number; // payment amount that rolls to next debt after payoff
}

export function calculateCascade(
  debts: MockDebt[],
  strategy: 'avalanche' | 'snowball',
  extraPayment: number = 0
): CascadeDebt[] {
  const ordered =
    strategy === 'avalanche'
      ? [...debts].sort((a, b) => b.apr - a.apr)
      : [...debts].sort((a, b) => a.balance - b.balance);

  const result: CascadeDebt[] = [];
  let rollover = extraPayment;

  for (const d of ordered) {
    const totalPayment = d.minPayment + rollover;
    const months = monthsToPayoff(d.balance, d.apr, totalPayment);
    const interest = Math.max(0, totalPayment * months - d.balance);
    const payoffDate = new Date();
    payoffDate.setMonth(payoffDate.getMonth() + months);

    result.push({
      ...d,
      suggestedPayment: totalPayment,
      monthsToPayoff: months,
      totalInterest: interest,
      payoffDate,
      rolledOverAmount: totalPayment,
    });

    rollover += d.minPayment; // roll minimum payment into next debt
  }

  return result;
}

function monthsToPayoff(balance: number, apr: number, payment: number): number {
  const monthlyRate = apr / 100 / 12;
  if (payment <= balance * monthlyRate) return 999;
  if (monthlyRate === 0) return Math.ceil(balance / payment);
  return Math.ceil(
    Math.log(payment / (payment - balance * monthlyRate)) / Math.log(1 + monthlyRate)
  );
}

// ── Format helpers ────────────────────────────────────────────────────────────

export function formatDateShort(d: Date): string {
  const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${mn[d.getMonth()]} ${d.getFullYear()}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
