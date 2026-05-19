import { generateText } from "ai";
import { and, eq, gte, accounts, recurringTransactions, transactions } from "@lasagna/core";
import { db } from "./db.js";
import { getModel } from "../agent/index.js";

const SYSTEM = `You analyze a user's recent bank transactions and identify RECURRING expenses and income.

You will be given:
1. A list of the user's connected ACCOUNTS (including any debt accounts — loans, credit cards). Use these as ground truth for what kind of debt payments to expect.
2. The TRANSACTIONS from the last 6 months.

Explicitly look for ALL of these common recurring categories — do not skip any that match:
- Mortgage or rent
- Credit card payments (often paid to the cardholder bank — match to the user's listed credit card accounts)
- Auto loan / car payment (match to the user's listed loan accounts where possible)
- Student loan payments
- Personal loan or HELOC payments
- Insurance: auto, home, renters, health, life, pet
- Utilities: electric, gas, water, internet, cable, phone/cell
- Streaming and software subscriptions (Netflix, Spotify, Apple, Google, gym, etc.)
- HOA or property fees
- Childcare, school tuition
- Regular paycheck or direct deposit

Rules:
- Only flag patterns you've seen at least 3 times (or 2 times if the merchant is unambiguously a debt account from the list).
- Allow amount variations (±15% for utilities, more for credit card payments which vary).
- Match credit card and loan payments back to the named account from the list when possible (use the account name in the pattern name).
- Skip one-time charges and skip transfers between the user's own accounts.
- Skip irregular cadence (>30% variance in spacing).

Return ONLY a JSON array. No prose, no markdown. Each element:
{
  "name": "human-readable name, e.g. Mortgage, Chase Sapphire Payment, Tesla Auto Loan",
  "merchantName": "merchant as shown in transactions",
  "amount": <number, typical amount, positive>,
  "frequency": "weekly" | "biweekly" | "monthly" | "quarterly" | "annually",
  "category": "subscriptions" | "housing" | "utilities" | "insurance" | "transportation" | "healthcare" | "food_dining" | "debt_payment" | "income" | "other",
  "nextDueDate": "<ISO date, yyyy-mm-dd>",
  "confidence": <0.0-1.0>,
  "reasoning": "<1 sentence why this is recurring, and which account it pays off if applicable>"
}

If nothing recurring is found, return [].`;

interface LLMResult {
  name: string;
  merchantName: string;
  amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "annually";
  category: string;
  nextDueDate: string;
  confidence: number;
  reasoning: string;
}

const VALID_FREQ = new Set(["weekly", "biweekly", "monthly", "quarterly", "annually"]);
const VALID_CAT = new Set([
  "income", "housing", "transportation", "food_dining", "groceries",
  "utilities", "healthcare", "insurance", "entertainment", "shopping",
  "personal_care", "education", "travel", "subscriptions",
  "savings_investment", "debt_payment", "gifts_donations", "taxes",
  "transfer", "other",
]);

export async function detectRecurringForTenant(tenantId: string): Promise<{
  detected: number;
  written: number;
}> {
  // Connected accounts — used as ground truth for debt payment detection.
  const accts = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
    })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));

  // Pull last 6 months of transactions
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
      category: transactions.category,
    })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), gte(transactions.date, sixMonthsAgo)));

  if (recent.length < 6) {
    return { detected: 0, written: 0 };
  }

  // Compact representation to keep the prompt small
  const compact = recent.map((t) => ({
    d: t.date.toISOString().slice(0, 10),
    m: t.merchantName || t.name,
    a: Number(t.amount),
    c: t.category,
  }));

  const accountCtx = accts.map((a) => ({
    name: a.name,
    type: a.type,
    subtype: a.subtype,
  }));

  const model = getModel("medium");
  const result = await generateText({
    model,
    system: SYSTEM,
    prompt: `Accounts on file (use these to recognize debt payments):
${JSON.stringify(accountCtx, null, 2)}

Transactions (last 6 months, ${compact.length} total):
${JSON.stringify(compact)}`,
    temperature: 0.2,
    maxOutputTokens: 4000,
  });

  let parsed: LLMResult[];
  try {
    let text = result.text.trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (m) text = m[0];
    parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch (e) {
    console.error("[recurring] parse failed:", e instanceof Error ? e.message : e);
    console.error("[recurring] raw:", result.text.slice(0, 1000));
    return { detected: 0, written: 0 };
  }

  // Wipe existing non-dismissed rows so we re-stamp from the latest LLM run.
  // Dismissed rows are preserved so the user's overrides survive.
  await db
    .delete(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.tenantId, tenantId),
        eq(recurringTransactions.isActive, true),
      ),
    );

  // Index recent transactions by lowercased merchant for accountId lookup.
  const txByMerchant = new Map<
    string,
    Array<{ accountId: string | null; amount: number }>
  >();
  // We need accountId — re-query with it (the earlier select omitted it for prompt brevity).
  const recentWithAccount = await db
    .select({
      accountId: transactions.accountId,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), gte(transactions.date, sixMonthsAgo)));
  for (const t of recentWithAccount) {
    const key = (t.merchantName || t.name).toLowerCase().trim();
    if (!txByMerchant.has(key)) txByMerchant.set(key, []);
    txByMerchant.get(key)!.push({ accountId: t.accountId, amount: Number(t.amount) });
  }

  function resolveAccountId(merchantName: string, amount: number): string | null {
    const merchantKey = merchantName.toLowerCase().trim();
    // Try exact match first
    let candidates = txByMerchant.get(merchantKey) ?? [];
    // Fall back to fuzzy includes match on the merchant key
    if (candidates.length === 0) {
      for (const [k, v] of txByMerchant) {
        if (k.includes(merchantKey) || merchantKey.includes(k)) {
          candidates.push(...v);
        }
      }
    }
    // Filter to amounts within 25% of the LLM's claimed amount
    const tol = Math.max(amount * 0.25, 5);
    const close = candidates.filter((t) => Math.abs(Math.abs(t.amount) - amount) <= tol);
    const pool = close.length > 0 ? close : candidates;
    // Mode of accountId
    const counts = new Map<string, number>();
    for (const t of pool) {
      if (!t.accountId) continue;
      counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
    }
    let bestId: string | null = null;
    let bestCount = 0;
    for (const [id, c] of counts) {
      if (c > bestCount) {
        bestCount = c;
        bestId = id;
      }
    }
    return bestId;
  }

  let written = 0;
  for (const r of parsed) {
    if (!r.name || !r.merchantName || !r.frequency || !VALID_FREQ.has(r.frequency)) continue;
    if (typeof r.amount !== "number" || Number.isNaN(r.amount)) continue;
    const cat = VALID_CAT.has(r.category) ? r.category : "other";
    const nextDue = r.nextDueDate ? new Date(r.nextDueDate) : null;
    if (nextDue && Number.isNaN(nextDue.getTime())) continue;

    const accountId = resolveAccountId(r.merchantName, r.amount);

    await db.insert(recurringTransactions).values({
      tenantId,
      accountId,
      name: r.name.slice(0, 255),
      merchantName: r.merchantName.slice(0, 255),
      amount: String(r.amount),
      frequency: r.frequency,
      category: cat as never,
      nextDueDate: nextDue,
      lastSeenDate: new Date(),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)).toFixed(2),
      reasoning: r.reasoning?.slice(0, 1000) ?? null,
      detectedAt: new Date(),
    });
    written++;
  }

  return { detected: parsed.length, written };
}
