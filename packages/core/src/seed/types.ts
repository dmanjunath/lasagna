export interface AssetConfig {
  cash?: number;
  savings?: number;
  roth_401k?: number;
  trad_401k?: number;
  roth_ira?: number;
  trad_ira?: number;
  brokerage?: number;
  hsa?: number;
  "529"?: number;
  crypto?: number;
  cd?: number;
  money_market?: number;
}

export interface PropertyConfig {
  primary?: number;
  [key: `rental${number}`]: number;
}

export interface AlternativesConfig {
  pe?: number;
  hedge?: number;
  angel?: number;
  crypto_alt?: number;
}

export interface LoanConfig {
  credit_card?: number | string; // number or "amount@rate"
  student_loan?: number | string;
  car?: number | string;
  primary_mortgage?: number | string;
  [key: `rental${number}_mortgage`]: number | string;
}

export interface SeedConfig {
  assets?: AssetConfig;
  property?: PropertyConfig;
  alternatives?: AlternativesConfig;
  loans?: LoanConfig;
}

export interface SeedResult {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  timestamp: number;
}

export const DEFAULT_INTEREST_RATES: Record<string, number> = {
  credit_card: 24.99,
  student_loan: 6.5,
  car: 7.5,
  primary_mortgage: 6.75,
  rental_mortgage: 7.25,
};
