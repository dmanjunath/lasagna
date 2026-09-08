import type { Database } from "../../db.js";
import { accounts, balanceSnapshots } from "../../schema.js";
import { balanceHistory } from "./history.js";
import type { LoanConfig } from "../types.js";
import { DEFAULT_INTEREST_RATES } from "../types.js";
import { parseLoanValue, randomVariance } from "../utils.js";

const LOAN_TYPE_MAP: Record<
  string,
  { type: "credit" | "loan"; subtype: string; name: string }
> = {
  credit_card: { type: "credit", subtype: "credit card", name: "Credit Card" },
  student_loan: { type: "loan", subtype: "student", name: "Student Loan" },
  car: { type: "loan", subtype: "auto", name: "Auto Loan" },
  primary_mortgage: {
    type: "loan",
    subtype: "mortgage",
    name: "Primary Mortgage",
  },
};

export async function generateLoans(
  db: Database,
  tenantId: string,
  plaidItemId: string,
  config: LoanConfig,
  timestamp: number,
): Promise<string[]> {
  const accountIds: string[] = [];
  const now = new Date();

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;

    const { amount, rate } = parseLoanValue(value);
    if (amount === 0) continue;

    // Determine loan type and defaults
    let mapping = LOAN_TYPE_MAP[key];
    let defaultRateKey = key;

    // Handle rental mortgages dynamically
    if (!mapping && key.includes("_mortgage")) {
      const rentalNum = key.replace("_mortgage", "").replace("rental", "");
      mapping = {
        type: "loan",
        subtype: "mortgage",
        name: `Rental ${rentalNum} Mortgage`,
      };
      defaultRateKey = "rental_mortgage";
    }

    if (!mapping) continue;

    const interestRate = rate ?? DEFAULT_INTEREST_RATES[defaultRateKey] ?? 7.0;
    const balance = -Math.abs(randomVariance(amount)); // Loans are negative

    const [account] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId,
        plaidAccountId: `${timestamp}-loan-${key}`,
        name: mapping.name,
        type: mapping.type,
        subtype: mapping.subtype,
        mask: generateMask(),
        metadata: JSON.stringify({
          interestRate,
          termMonths: key.includes("mortgage")
            ? 360
            : key === "car"
              ? 60
              : key === "student_loan"
                ? 120
                : null,
          originationDate: generateOriginationDate(),
        }),
      })
      .returning();

    accountIds.push(account.id);

    // Negative drift: a debt stood higher a year ago than it does now, so the
    // history reads as a balance being paid down rather than noise.
    await db.insert(balanceSnapshots).values(
      balanceHistory(now, balance, -0.06, 0.002).map((p) => ({
        accountId: account.id,
        tenantId,
        balance: p.balance.toFixed(2),
        limit: mapping.type === "credit" ? String(Math.abs(balance) * 2) : null,
        isoCurrencyCode: "USD",
        snapshotAt: p.snapshotAt,
      })),
    );
  }

  return accountIds;
}

function generateMask(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateOriginationDate(): string {
  const yearsAgo = Math.floor(Math.random() * 5) + 1;
  const date = new Date();
  date.setFullYear(date.getFullYear() - yearsAgo);
  return date.toISOString().split("T")[0];
}
