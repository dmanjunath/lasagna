import { generateText } from "ai";
import { getModel } from "../agent/index.js";
import { db } from "./db.js";
import {
  accounts,
  balanceSnapshots,
  holdings,
  securities,
  insights,
  financialProfiles,
  eq,
  and,
  desc,
  sql,
} from "@lasagna/core";

interface FinancialSnapshot {
  accounts: Array<{
    name: string;
    type: string;
    subtype: string | null;
    balance: number;
    metadata: Record<string, unknown> | null;
  }>;
  holdings: Array<{
    ticker: string;
    name: string;
    quantity: number;
    value: number;
    costBasis: number | null;
    accountName: string;
  }>;
  profile: {
    annualIncome: number | null;
    filingStatus: string | null;
    stateOfResidence: string | null;
    riskTolerance: string | null;
    retirementAge: number | null;
    employerMatchPercent: number | null;
    age: number | null;
  } | null;
  summary: {
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
    totalDepository: number;
    totalInvestment: number;
    totalCredit: number;
    totalLoan: number;
  };
}

interface GeneratedInsight {
  category: "portfolio" | "debt" | "tax" | "savings" | "general";
  urgency: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  impact: string;
  impactColor: "green" | "amber" | "red";
  chatPrompt: string;
}

// Gather all financial data for a tenant
async function gatherFinancialData(
  tenantId: string
): Promise<FinancialSnapshot> {
  // Accounts with latest balance
  const accts = await db
    .select({
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      metadata: accounts.metadata,
      accountId: accounts.id,
    })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));

  const accountsWithBalances = await Promise.all(
    accts.map(async (a) => {
      const [snap] = await db
        .select({ balance: balanceSnapshots.balance })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, a.accountId))
        .orderBy(desc(balanceSnapshots.snapshotAt))
        .limit(1);

      let metadata: Record<string, unknown> | null = null;
      try {
        if (a.metadata) metadata = JSON.parse(a.metadata);
      } catch {
        /* ignore */
      }

      return {
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        balance: parseFloat(snap?.balance || "0"),
        metadata,
      };
    })
  );

  // Holdings
  const holdingRows = await db
    .select({
      ticker: securities.tickerSymbol,
      secName: securities.name,
      quantity: holdings.quantity,
      value: holdings.institutionValue,
      costBasis: holdings.costBasis,
      accountName: accounts.name,
    })
    .from(holdings)
    .innerJoin(securities, eq(holdings.securityId, securities.id))
    .innerJoin(accounts, eq(holdings.accountId, accounts.id))
    .where(eq(holdings.tenantId, tenantId));

  const holdingsData = holdingRows.map((h) => ({
    ticker: h.ticker || "Unknown",
    name: h.secName || "Unknown",
    quantity: parseFloat(h.quantity || "0"),
    value: parseFloat(h.value || "0"),
    costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
    accountName: h.accountName,
  }));

  // Profile
  const [profileRow] = await db
    .select()
    .from(financialProfiles)
    .where(eq(financialProfiles.tenantId, tenantId))
    .limit(1);

  let profile: FinancialSnapshot["profile"] = null;
  if (profileRow) {
    const age = profileRow.dateOfBirth
      ? Math.floor(
          (Date.now() - new Date(profileRow.dateOfBirth).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000)
        )
      : null;
    profile = {
      annualIncome: profileRow.annualIncome
        ? parseFloat(profileRow.annualIncome)
        : null,
      filingStatus: profileRow.filingStatus,
      stateOfResidence: profileRow.stateOfResidence,
      riskTolerance: profileRow.riskTolerance,
      retirementAge: profileRow.retirementAge,
      employerMatchPercent: profileRow.employerMatch
        ? parseFloat(profileRow.employerMatch)
        : null,
      age,
    };
  }

  // Summary
  let totalAssets = 0,
    totalLiabilities = 0,
    totalDepository = 0,
    totalInvestment = 0,
    totalCredit = 0,
    totalLoan = 0;

  for (const a of accountsWithBalances) {
    if (a.type === "credit" || a.type === "loan") {
      totalLiabilities += a.balance;
      if (a.type === "credit") totalCredit += a.balance;
      if (a.type === "loan") totalLoan += a.balance;
    } else {
      totalAssets += a.balance;
      if (a.type === "depository") totalDepository += a.balance;
      if (a.type === "investment") totalInvestment += a.balance;
    }
  }

  return {
    accounts: accountsWithBalances,
    holdings: holdingsData,
    profile,
    summary: {
      netWorth: totalAssets - totalLiabilities,
      totalAssets,
      totalLiabilities,
      totalDepository,
      totalInvestment,
      totalCredit,
      totalLoan,
    },
  };
}

const INSIGHTS_PROMPT = `You are Lasagna's financial insights engine. Analyze the user's financial data and generate 3-6 actionable, personalized insights.

Each insight should be specific to THIS user's data — not generic advice. Reference their actual numbers.

Categories: portfolio, debt, tax, savings, general
Urgency: critical (needs action this week), high (this month), medium (this quarter), low (nice to know)

Respond with ONLY a JSON array, no other text:
[
  {
    "category": "portfolio",
    "urgency": "high",
    "title": "Your portfolio is 72% US stocks — add international exposure",
    "description": "With $19,350 in VTI and only $8,740 in VXUS, you're overweight US stocks at 72% vs your 60% target. Consider selling $3,700 of VTI and buying VXUS to rebalance.",
    "impact": "Reduces concentration risk",
    "impactColor": "amber",
    "chatPrompt": "Help me rebalance my portfolio — I'm overweight US stocks"
  }
]

Rules:
- Reference specific dollar amounts, account names, percentages from the data
- If user has high-APR debt (>15%), always include a debt insight as critical/high
- If emergency fund is <3 months expenses, include a savings insight
- If tax-advantaged accounts are unfunded (Roth IRA, HSA), include a tax insight
- If portfolio is concentrated (>70% in one asset class), include a portfolio insight
- If user has no profile data, include a general insight to complete their profile
- impactColor: green (positive/savings), amber (caution/action needed), red (urgent/losing money)
- Each chatPrompt should be a natural question the user would ask the AI advisor

Return 3-6 insights. Fewer if the user has limited data.`;

export async function generateInsights(tenantId: string): Promise<number> {
  const data = await gatherFinancialData(tenantId);

  // Don't generate if no accounts
  if (data.accounts.length === 0) return 0;

  const dataJson = JSON.stringify(data, null, 2);

  let model: ReturnType<typeof getModel>;
  try {
    model = getModel();
  } catch {
    console.error("Insights engine: AI model not available");
    return 0;
  }

  const result = await generateText({
    model,
    system: INSIGHTS_PROMPT,
    prompt: `Here is the user's financial data:\n\n${dataJson}`,
    temperature: 0.3,
    maxTokens: 2000,
  });

  // Parse the response
  let generated: GeneratedInsight[];
  try {
    // Extract JSON array from the response (handle markdown code blocks)
    let text = result.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) text = jsonMatch[0];
    generated = JSON.parse(text);
    if (!Array.isArray(generated)) throw new Error("Not an array");
  } catch (e) {
    console.error("Insights engine: Failed to parse AI response:", e);
    console.error("Raw response:", result.text);
    return 0;
  }

  // Keep critical/high insights that are still active — only clear low/medium
  // This way important insights persist until the user dismisses them or they expire
  await db
    .delete(insights)
    .where(
      and(
        eq(insights.tenantId, tenantId),
        sql`${insights.dismissed} IS NULL`,
        sql`${insights.urgency} IN ('low', 'medium')`
      )
    );

  // Check which critical/high insights already exist (by title) to avoid duplicates
  const existingHighPriority = await db
    .select({ title: insights.title })
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, tenantId),
        sql`${insights.dismissed} IS NULL`,
        sql`${insights.urgency} IN ('critical', 'high')`
      )
    );
  const existingTitles = new Set(existingHighPriority.map((r) => r.title));

  // Insert new insights
  const validCategories = [
    "portfolio",
    "debt",
    "tax",
    "savings",
    "general",
  ] as const;
  const validUrgencies = ["low", "medium", "high", "critical"] as const;
  const validColors = ["green", "amber", "red"];

  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  let insertCount = 0;
  for (const ins of generated.slice(0, 6)) {
    const category = validCategories.includes(
      ins.category as (typeof validCategories)[number]
    )
      ? ins.category
      : "general";
    const urgency = validUrgencies.includes(
      ins.urgency as (typeof validUrgencies)[number]
    )
      ? ins.urgency
      : "medium";

    // Skip if a critical/high insight with the same title already exists
    if (
      (urgency === "critical" || urgency === "high") &&
      existingTitles.has(ins.title)
    ) {
      continue;
    }

    await db.insert(insights).values({
      tenantId,
      category,
      urgency,
      title: ins.title || "Financial insight",
      description: ins.description || "",
      impact: ins.impact || null,
      impactColor: validColors.includes(ins.impactColor)
        ? ins.impactColor
        : null,
      chatPrompt: ins.chatPrompt || null,
      generatedBy: "ai",
      sourceData: dataJson,
      expiresAt: new Date(Date.now() + NINETY_DAYS),
    });
    insertCount++;
  }

  return insertCount;
}
