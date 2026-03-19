export interface FinancialState {
  totalDebt: number;
  totalDepository: number;
  totalInvestment: number;
  monthlyExpenses: number; // estimated from credit balances
  hasLinkedAccounts: boolean;
  employerMatchPercent: number | null;
  annualIncome: number | null;
  riskTolerance: string | null;
  debtCount: number;
  highestApr: number | null;
  highestAprCreditor: string | null;
}

export interface ActionItemData {
  title: string;
  tag: string;
  description: string;
  impact: string;
  impactColor: 'green' | 'amber' | 'red';
  chatPrompt: string;
  insightId?: string; // if backed by a DB insight, enables dismiss
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function generateActionItems(state: FinancialState): ActionItemData[] {
  const items: ActionItemData[] = [];

  // 1. No linked accounts — always first
  if (!state.hasLinkedAccounts) {
    items.push({
      title: 'Link your bank accounts',
      tag: 'SETUP',
      description:
        'Connect your bank, credit card, and investment accounts so Lasagna can analyze your full financial picture and give personalized advice.',
      impact: 'Unlock all features',
      impactColor: 'green',
      chatPrompt: 'How do I link my bank accounts?',
    });
  }

  // 2. High APR debt (>15%)
  if (state.highestApr !== null && state.highestApr > 15) {
    const creditor = state.highestAprCreditor || 'your creditor';
    items.push({
      title: `Call ${creditor} to negotiate rate`,
      tag: 'DEBT',
      description: `Your highest interest rate is ${state.highestApr.toFixed(1)}%. A single phone call can often reduce it by 2-5 points, saving you hundreds per year.`,
      impact: `${state.highestApr.toFixed(1)}% APR — negotiate down`,
      impactColor: 'red',
      chatPrompt: `How do I negotiate a lower interest rate on my ${creditor} debt at ${state.highestApr.toFixed(1)}% APR?`,
    });
  }

  // 3. Has any debt — set up autopay
  if (state.totalDebt > 0) {
    items.push({
      title: 'Set up autopay on all debts',
      tag: 'DEBT',
      description:
        'Autopay prevents late fees and can earn a 0.25% interest rate discount with many lenders. Set at least the minimum payment on every account.',
      impact: 'Avoid late fees & penalties',
      impactColor: 'green',
      chatPrompt: 'How do I set up autopay on my debts and which ones should I prioritize?',
    });
  }

  // 4. Employer match available but not fully captured
  if (
    state.employerMatchPercent !== null &&
    state.employerMatchPercent > 0 &&
    state.annualIncome !== null
  ) {
    const matchAmount = Math.round(
      state.annualIncome * (state.employerMatchPercent / 100)
    );
    const shouldSuggest =
      state.totalInvestment < state.annualIncome * (state.employerMatchPercent / 100);

    if (shouldSuggest) {
      items.push({
        title: `Set 401(k) to capture employer match`,
        tag: 'INVEST',
        description: `Your employer matches up to ${state.employerMatchPercent}% of your salary. Set your contribution to at least ${state.employerMatchPercent}% to capture ${formatCurrency(matchAmount)}/yr in free money.`,
        impact: `+${formatCurrency(matchAmount)}/yr free money`,
        impactColor: 'green',
        chatPrompt: `How do I set up my 401(k) to capture my employer's ${state.employerMatchPercent}% match?`,
      });
    }
  }

  // 5. No debt but low emergency fund (<3 months)
  if (
    state.totalDebt === 0 &&
    state.monthlyExpenses > 0 &&
    state.totalDepository < state.monthlyExpenses * 3
  ) {
    const target = formatCurrency(state.monthlyExpenses * 3);
    items.push({
      title: 'Build emergency fund to 3 months',
      tag: 'SAVINGS',
      description: `You have ${formatCurrency(state.totalDepository)} saved against ${formatCurrency(state.monthlyExpenses)}/mo in expenses. Target ${target} for a solid safety net.`,
      impact: `Target: ${target}`,
      impactColor: 'amber',
      chatPrompt:
        'How should I build my emergency fund? Where should I keep it?',
    });
  }

  // 6. No debt and healthy emergency fund — open Roth IRA
  if (
    state.totalDebt === 0 &&
    (state.monthlyExpenses === 0 ||
      state.totalDepository >= state.monthlyExpenses * 3)
  ) {
    items.push({
      title: 'Open & fund Roth IRA ($7,000)',
      tag: 'INVEST',
      description:
        'Open a Roth IRA at Vanguard or Fidelity. Invest in a 3-fund index portfolio (VTI/VXUS/BND). Contributions grow tax-free forever.',
      impact: 'Tax-free growth forever',
      impactColor: 'green',
      chatPrompt: 'How do I open and fund a Roth IRA?',
    });
  }

  // 7. Has investment accounts — check allocation
  if (state.totalInvestment > 0) {
    items.push({
      title: 'Check portfolio allocation vs target',
      tag: 'INVEST',
      description:
        'Review your current asset allocation against your target based on age and risk tolerance. Rebalance if any asset class has drifted more than 5%.',
      impact: 'Stay on target',
      impactColor: 'green',
      chatPrompt:
        'Is my portfolio allocation appropriate for my age and risk tolerance?',
    });
  }

  // 8. Has income data — review W-4
  if (state.annualIncome !== null && state.annualIncome > 0) {
    items.push({
      title: 'Review W-4 withholding',
      tag: 'TAX',
      description:
        'Make sure you are not over- or under-withholding federal taxes. Use the IRS withholding estimator to check and adjust your W-4 with your employer.',
      impact: 'Avoid surprises at tax time',
      impactColor: 'amber',
      chatPrompt:
        'Should I adjust my W-4 withholding? How do I check if I am withholding the right amount?',
    });
  }

  // 9. No debt — set up credit monitoring
  if (state.totalDebt === 0) {
    items.push({
      title: 'Set up credit monitoring',
      tag: 'DEBT',
      description:
        'Free via Credit Karma or your bank. Catches fraud early and tracks your credit score over time.',
      impact: 'Early fraud detection',
      impactColor: 'green',
      chatPrompt: 'How do I set up credit monitoring?',
    });
  }

  // 10. Fallback — complete profile
  items.push({
    title: 'Complete your financial profile',
    tag: 'SETUP',
    description:
      'Add your income, age, filing status, and employer match details so Lasagna can give you more personalized action items and advice.',
    impact: 'Better recommendations',
    impactColor: 'green',
    chatPrompt:
      'What information should I add to my financial profile to get better advice?',
  });

  return items.slice(0, 6);
}
