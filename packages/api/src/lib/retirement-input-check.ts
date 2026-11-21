import { isMortgageAccount, type DebtAccount } from "./debt-accounts.js";
import { monthsToPayOff, scheduledPayoff } from "./path-sizing.js";

/**
 * The one retirement input the page should ask the user about, or null.
 *
 * A plan built on an unlikely retirement age reads as a confident verdict on
 * the wrong question. This names the most important doubtful input so the page
 * can ask "Is that right?" and offer the fix in place.
 */
export type RetirementInputCheck =
  | { kind: "missing_dob"; assumedAge: number }
  | { kind: "age_passed"; currentAge: number; retirementAge: number }
  | {
      kind: "soon_with_mortgage";
      currentAge: number;
      retirementAge: number;
      yearsAway: number;
      mortgageName: string;
      mortgageEndYear: number;
    }
  | { kind: "missing_retirement_age"; assumedAge: number };

/** Retiring this many years from now or sooner counts as "soon". */
const SOON_YEARS = 5;
/** A mortgage running this many years past retirement makes "soon" doubtful. */
const MORTGAGE_TAIL_YEARS = 15;

/**
 * The year a mortgage ends, from evidence only: the lender's date, else its
 * origination plus a known term, else the lender's payment worked out against
 * the balance. Null when the end would rest on an assumption (no term on file,
 * or a payment the app estimated), because the prompt states the year as fact.
 */
function mortgageEndYear(debt: DebtAccount, now: Date): number | null {
  const dated =
    debt.payoffDate ??
    (debt.termMonths != null
      ? scheduledPayoff({
          originationDate: debt.originationDate,
          termMonths: debt.termMonths,
          debtKind: "mortgage",
        })
      : null);
  if (dated) {
    const year = new Date(dated).getUTCFullYear();
    if (Number.isFinite(year)) return year;
  }
  if (debt.minimumPaymentEstimated) return null;
  const months = monthsToPayOff(debt.balance, debt.minimumPayment, debt.apr);
  if (!Number.isFinite(months)) return null;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)).getUTCFullYear();
}

export function checkRetirementInputs(args: {
  currentAge: number;
  retirementAge: number;
  dobOnFile: boolean;
  retirementAgeOnFile: boolean;
  debts: DebtAccount[];
  now?: Date;
}): RetirementInputCheck | null {
  const { currentAge, retirementAge, dobOnFile, retirementAgeOnFile, debts } = args;
  const now = args.now ?? new Date();

  if (!dobOnFile) return { kind: "missing_dob", assumedAge: currentAge };

  if (retirementAgeOnFile && retirementAge < currentAge) {
    return { kind: "age_passed", currentAge, retirementAge };
  }

  const yearsAway = retirementAge - currentAge;
  if (yearsAway >= 0 && yearsAway <= SOON_YEARS) {
    const retirementYear = now.getUTCFullYear() + yearsAway;
    let latest: { name: string; endYear: number } | null = null;
    for (const debt of debts) {
      if (!isMortgageAccount(debt) || !(debt.balance > 0)) continue;
      const endYear = mortgageEndYear(debt, now);
      if (endYear == null || endYear - retirementYear < MORTGAGE_TAIL_YEARS) continue;
      if (!latest || endYear > latest.endYear) latest = { name: debt.name, endYear };
    }
    if (latest) {
      return {
        kind: "soon_with_mortgage",
        currentAge,
        retirementAge,
        yearsAway,
        mortgageName: latest.name,
        mortgageEndYear: latest.endYear,
      };
    }
  }

  if (!retirementAgeOnFile) return { kind: "missing_retirement_age", assumedAge: retirementAge };

  return null;
}
