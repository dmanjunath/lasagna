import type { Database } from "../../db.js";
import { transactions, type transactionCategoryEnum } from "../../schema.js";

type TransactionCategory = (typeof transactionCategoryEnum.enumValues)[number];
type TransactionInsert = typeof transactions.$inferInsert;

interface TransactionTemplate {
  name: string;
  merchant: string | null;
  amountRange: [number, number];
}

const TRANSACTION_TEMPLATES: Record<string, TransactionTemplate[]> = {
  income: [
    { name: "Direct Deposit - Employer", merchant: "Employer", amountRange: [-4000, -8000] },
  ],
  housing: [
    { name: "Rent Payment", merchant: "Property Management", amountRange: [1500, 3000] },
    { name: "Mortgage Payment", merchant: "Bank Mortgage", amountRange: [1800, 3500] },
  ],
  food_dining: [
    { name: "DoorDash", merchant: "DoorDash", amountRange: [15, 65] },
    { name: "Chipotle", merchant: "Chipotle", amountRange: [12, 20] },
    { name: "Starbucks", merchant: "Starbucks", amountRange: [5, 12] },
    { name: "Restaurant", merchant: null, amountRange: [25, 120] },
  ],
  groceries: [
    { name: "Whole Foods Market", merchant: "Whole Foods", amountRange: [40, 180] },
    { name: "Trader Joe's", merchant: "Trader Joe's", amountRange: [30, 120] },
    { name: "Costco", merchant: "Costco", amountRange: [80, 300] },
  ],
  utilities: [
    { name: "Electric Bill", merchant: "Power Company", amountRange: [80, 200] },
    { name: "Internet - Comcast", merchant: "Comcast", amountRange: [60, 100] },
    { name: "Water Bill", merchant: "Water Utility", amountRange: [30, 80] },
    { name: "Cell Phone", merchant: "T-Mobile", amountRange: [50, 120] },
  ],
  transportation: [
    { name: "Shell Gas Station", merchant: "Shell", amountRange: [35, 70] },
    { name: "Uber", merchant: "Uber", amountRange: [10, 45] },
    { name: "Auto Insurance", merchant: "Geico", amountRange: [100, 200] },
  ],
  subscriptions: [
    { name: "Netflix", merchant: "Netflix", amountRange: [15, 23] },
    { name: "Spotify", merchant: "Spotify", amountRange: [10, 16] },
    { name: "Amazon Prime", merchant: "Amazon", amountRange: [14, 15] },
    { name: "iCloud Storage", merchant: "Apple", amountRange: [3, 10] },
    { name: "Gym Membership", merchant: "Planet Fitness", amountRange: [25, 60] },
  ],
  shopping: [
    { name: "Amazon.com", merchant: "Amazon", amountRange: [15, 200] },
    { name: "Target", merchant: "Target", amountRange: [20, 150] },
    { name: "Clothing Store", merchant: null, amountRange: [30, 200] },
  ],
  healthcare: [
    { name: "CVS Pharmacy", merchant: "CVS", amountRange: [10, 80] },
    { name: "Doctor Visit Copay", merchant: null, amountRange: [20, 50] },
  ],
  entertainment: [
    { name: "Movie Theater", merchant: "AMC", amountRange: [15, 40] },
    { name: "Concert Tickets", merchant: "Ticketmaster", amountRange: [50, 200] },
  ],
  savings_investment: [
    { name: "Transfer to Savings", merchant: null, amountRange: [500, 2000] },
    { name: "Brokerage Deposit", merchant: null, amountRange: [500, 3000] },
  ],
  transfer: [
    { name: "Venmo Transfer", merchant: "Venmo", amountRange: [20, 100] },
    { name: "Zelle Transfer", merchant: "Zelle", amountRange: [25, 200] },
  ],
};

function randomInRange(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDay(month: number, year: number, minDay = 1, maxDay = 28): Date {
  const day = Math.floor(minDay + Math.random() * (maxDay - minDay + 1));
  const clampedDay = Math.min(day, 28);
  const hour = Math.floor(8 + Math.random() * 14); // 8am - 10pm
  const minute = Math.floor(Math.random() * 60);
  return new Date(year, month, clampedDay, hour, minute);
}

function createTransaction(
  template: TransactionTemplate,
  date: Date,
  accountId: string,
  tenantId: string,
  category: TransactionCategory,
  incomeMultiplier: number,
): TransactionInsert {
  const [lo, hi] = template.amountRange;
  const baseAmount = randomInRange(Math.min(lo, hi), Math.max(lo, hi));
  // Scale amounts based on income multiplier (base is 175k annual / ~$7300 semi-monthly)
  const amount = Math.round(baseAmount * incomeMultiplier * 100) / 100;

  return {
    accountId,
    tenantId,
    date,
    name: template.name,
    merchantName: template.merchant,
    amount: String(amount),
    category,
    pending: 0,
  };
}

export async function generateTransactions(
  db: Database,
  tenantId: string,
  checkingAccountId: string,
  creditAccountId: string,
  monthlyIncome: number,
): Promise<void> {
  const now = new Date();
  const allTransactions: TransactionInsert[] = [];

  // Income multiplier: base templates are designed for ~$175k annual income
  const incomeMultiplier = monthlyIncome / (175000 / 12);

  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const month = targetDate.getMonth();
    const year = targetDate.getFullYear();

    const txns: TransactionInsert[] = [];

    // 2 income deposits on 1st and 15th (checking)
    const incomeTemplate = TRANSACTION_TEMPLATES.income[0];
    txns.push(
      createTransaction(incomeTemplate, new Date(year, month, 1, 9, 0), checkingAccountId, tenantId, "income", incomeMultiplier),
      createTransaction(incomeTemplate, new Date(year, month, 15, 9, 0), checkingAccountId, tenantId, "income", incomeMultiplier),
    );

    // 1 housing payment (checking) on 1st-5th
    const housingTemplate = pickRandom(TRANSACTION_TEMPLATES.housing);
    txns.push(
      createTransaction(housingTemplate, randomDay(month, year, 1, 5), checkingAccountId, tenantId, "housing", incomeMultiplier),
    );

    // 3-5 dining out (credit card)
    const diningCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < diningCount; i++) {
      const template = pickRandom(TRANSACTION_TEMPLATES.food_dining);
      txns.push(
        createTransaction(template, randomDay(month, year), creditAccountId, tenantId, "food_dining", incomeMultiplier),
      );
    }

    // 2-3 grocery trips (credit card)
    const groceryCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < groceryCount; i++) {
      const template = pickRandom(TRANSACTION_TEMPLATES.groceries);
      txns.push(
        createTransaction(template, randomDay(month, year), creditAccountId, tenantId, "groceries", incomeMultiplier),
      );
    }

    // Monthly utilities (checking) - spread through month
    for (const template of TRANSACTION_TEMPLATES.utilities) {
      txns.push(
        createTransaction(template, randomDay(month, year, 5, 25), checkingAccountId, tenantId, "utilities", incomeMultiplier),
      );
    }

    // 2-4 subscriptions (credit card)
    const subCount = 2 + Math.floor(Math.random() * 3);
    const shuffledSubs = [...TRANSACTION_TEMPLATES.subscriptions].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(subCount, shuffledSubs.length); i++) {
      txns.push(
        createTransaction(shuffledSubs[i], randomDay(month, year, 1, 10), creditAccountId, tenantId, "subscriptions", incomeMultiplier),
      );
    }

    // 3-5 shopping transactions (credit card)
    const shopCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < shopCount; i++) {
      const template = pickRandom(TRANSACTION_TEMPLATES.shopping);
      txns.push(
        createTransaction(template, randomDay(month, year), creditAccountId, tenantId, "shopping", incomeMultiplier),
      );
    }

    // 1-2 transportation (credit card)
    const transCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < transCount; i++) {
      const template = pickRandom(TRANSACTION_TEMPLATES.transportation);
      txns.push(
        createTransaction(template, randomDay(month, year), creditAccountId, tenantId, "transportation", incomeMultiplier),
      );
    }

    // 1 healthcare every other month (credit card)
    if (monthsAgo % 2 === 0) {
      const template = pickRandom(TRANSACTION_TEMPLATES.healthcare);
      txns.push(
        createTransaction(template, randomDay(month, year, 10, 25), creditAccountId, tenantId, "healthcare", incomeMultiplier),
      );
    }

    // 1 entertainment (credit card)
    const entertainTemplate = pickRandom(TRANSACTION_TEMPLATES.entertainment);
    txns.push(
      createTransaction(entertainTemplate, randomDay(month, year), creditAccountId, tenantId, "entertainment", incomeMultiplier),
    );

    // 1 savings transfer (checking)
    const savingsTemplate = pickRandom(TRANSACTION_TEMPLATES.savings_investment);
    txns.push(
      createTransaction(savingsTemplate, randomDay(month, year, 2, 10), checkingAccountId, tenantId, "savings_investment", incomeMultiplier),
    );

    // 1-2 transfers occasionally
    if (Math.random() > 0.4) {
      const transferTemplate = pickRandom(TRANSACTION_TEMPLATES.transfer);
      txns.push(
        createTransaction(transferTemplate, randomDay(month, year), checkingAccountId, tenantId, "transfer", incomeMultiplier),
      );
    }

    // Mark a few recent transactions as pending
    if (monthsAgo === 0) {
      for (let i = txns.length - 1; i >= Math.max(0, txns.length - 3); i--) {
        if (txns[i].date > new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)) {
          txns[i].pending = 1;
        }
      }
    }

    allTransactions.push(...txns);
  }

  // Batch insert all transactions
  if (allTransactions.length > 0) {
    // Insert in chunks to avoid exceeding parameter limits
    const CHUNK_SIZE = 50;
    for (let i = 0; i < allTransactions.length; i += CHUNK_SIZE) {
      const chunk = allTransactions.slice(i, i + CHUNK_SIZE);
      await db.insert(transactions).values(chunk);
    }
  }
}
