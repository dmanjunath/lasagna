/**
 * Static fixture data used by benchmarks.
 * Mirrors the shape of what financial tools return so tests run without a live DB.
 */

export const portfolioFixture = {
  totalValue: 6479416.75,
  blendedHistoricalReturn: 9.37,
  assetClasses: [
    { name: 'US Stocks', value: 5620842.23, percentage: 86.75 },
    { name: 'Cash', value: 588735.09, percentage: 9.09 },
    { name: 'International Stocks', value: 150115.67, percentage: 2.32 },
    { name: 'Bonds', value: 113326.43, percentage: 1.75 },
    { name: 'Other', value: 6397.33, percentage: 0.10 },
  ],
  holdings: [
    { ticker: 'VTI', name: 'Vanguard Total Stock Market', value: 2790355.68, category: 'Total Market' },
    { ticker: 'VOO', name: 'Vanguard S&P 500', value: 2031119.43, category: 'S&P 500' },
    { ticker: 'QQQ', name: 'Invesco QQQ', value: 685261.66, category: 'Nasdaq' },
  ],
};

export const retirementFixture = {
  currentAge: 38,
  retirementAge: 60,
  lifeExpectancy: 90,
  portfolioValue: 6479416.75,
  monthlyContribution: 5000,
  monthlySpend: 15000,
  filingStatus: 'married_joint',
};

export const debtFixture = {
  totalDebt: 450000,
  debts: [
    { name: 'Mortgage', balance: 420000, apr: 3.5, minPayment: 2100, type: 'mortgage' },
    { name: 'Credit Card', balance: 18000, apr: 22.9, minPayment: 360, type: 'credit_card' },
    { name: 'Auto Loan', balance: 12000, apr: 6.9, minPayment: 280, type: 'auto' },
  ],
};

export const spendingFixture = {
  monthlyIncome: 25000,
  monthlyExpenses: 18500,
  savingsRate: 26,
  topCategories: [
    { name: 'Housing', amount: 4200, percentage: 22.7 },
    { name: 'Food & Dining', amount: 2800, percentage: 15.1 },
    { name: 'Transportation', amount: 1400, percentage: 7.6 },
    { name: 'Entertainment', amount: 900, percentage: 4.9 },
  ],
};

/** Page context strings that mirror what the frontend sends */
export const pageContexts = {
  portfolio: `[Context: User is viewing "Portfolio Composition". Shows portfolio allocation across asset classes, sub-categories, and individual holdings.

Financial data on this page:
- totalValue: $6,479,416.75
- blendedHistoricalReturn: 9.37
- assetClasses: ${JSON.stringify(portfolioFixture.assetClasses)}
]

`,
  retirement: `[Context: User is viewing "Retirement". Monte Carlo and historical backtest projections for retirement planning.

Financial data on this page:
- portfolioValue: $6,479,416.75
- currentAge: 38
- retirementAge: 60
- monthlySpend: $15,000
]

`,
  debt: `[Context: User is viewing "Debt". Overview of all debts, interest rates, and payoff strategies.

Financial data on this page:
- totalDebt: $450,000
- debts: ${JSON.stringify(debtFixture.debts)}
]

`,
};
