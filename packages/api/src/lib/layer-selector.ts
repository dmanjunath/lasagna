// ── UserFinancialContext ───────────────────────────────────────────────────────

export interface UserFinancialContext {
  // From profile
  age: number | null;
  annualIncome: number;
  filingStatus: 'single' | 'married_joint' | 'married_separate' | 'head_of_household' | null;
  employmentType: string | null; // 'w2' | 'self_employed' | '1099' | 'business_owner'
  employerMatchPct: number;
  stateOfResidence: string | null;
  retirementAge: number;
  riskTolerance: string | null;
  hasHDHP: boolean;
  dependentCount: number;          // 0 = none; derive hasDependents as > 0
  isPSLFEligible: boolean;
  goals: Array<{ id: string; name: string; category: string; targetAmount: number; currentAmount: number; deadline: Date | null }>;
  skippedLayerIds: string[];

  // From accounts
  cashTotal: number;
  hsaBalance: number;
  rothIraBalance: number;
  trad401kBalance: number;
  brokerageBalance: number;
  paydayLoanDebt: number;
  creditCardDebt: number;
  personalLoanHighDebt: number;   // APR >15%
  autoLoanHighDebt: number;       // APR >10%
  mediumInterestDebt: number;     // APR 6–15% (non-card, non-auto)
  autoLoanMedDebt: number;        // APR 6–10%
  personalLoanMedDebt: number;    // APR 6–15%
  federalStudentLoanDebt: number;
  privateStudentLoanDebt: number;
  autoLoanLowDebt: number;        // APR <5%
  studentLoanLowDebt: number;     // APR <5%, no PSLF
  mortgageBalance: number;
  medicalDebt: number;
  collectionsDebt: number;
  hasOverdraft: boolean;
  hasESPP: boolean;
  hasPension: boolean;
  has457b: boolean;
  has403b: boolean;
  hasInheritedIRA: boolean;

  // Computed
  monthlyExpenses: number | null;
  savingsRate: number | null;
}

export function buildContextDefaults(overrides: Partial<UserFinancialContext> = {}): UserFinancialContext {
  return {
    age: null,
    annualIncome: 0,
    filingStatus: null,
    employmentType: 'w2',
    employerMatchPct: 0,
    stateOfResidence: null,
    retirementAge: 65,
    riskTolerance: null,
    hasHDHP: false,
    dependentCount: 0,
    isPSLFEligible: false,
    goals: [],
    skippedLayerIds: [],
    cashTotal: 0,
    hsaBalance: 0,
    rothIraBalance: 0,
    trad401kBalance: 0,
    brokerageBalance: 0,
    paydayLoanDebt: 0,
    creditCardDebt: 0,
    personalLoanHighDebt: 0,
    autoLoanHighDebt: 0,
    mediumInterestDebt: 0,
    autoLoanMedDebt: 0,
    personalLoanMedDebt: 0,
    federalStudentLoanDebt: 0,
    privateStudentLoanDebt: 0,
    autoLoanLowDebt: 0,
    studentLoanLowDebt: 0,
    mortgageBalance: 0,
    medicalDebt: 0,
    collectionsDebt: 0,
    hasOverdraft: false,
    hasESPP: false,
    hasPension: false,
    has457b: false,
    has403b: false,
    hasInheritedIRA: false,
    monthlyExpenses: null,
    savingsRate: null,
    ...overrides,
  };
}
