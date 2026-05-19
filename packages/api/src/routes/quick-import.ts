import { Hono } from "hono";
import { z } from "zod";
import { generateObject } from "ai";
import {
  eq,
  and,
  accounts,
  balanceSnapshots,
  goals,
  financialProfiles,
  plaidItems,
  users,
} from "@lasagna/core";
import { db } from "../lib/db.js";
import { getModel } from "../agent/agent.js";
import { type AuthEnv } from "../middleware/auth.js";

export const quickImportRoutes = new Hono<AuthEnv>();

// ─────────────────────────────────────────────────────────────────────────────
// Shared schema — also used by /commit for re-validation
// ─────────────────────────────────────────────────────────────────────────────

const accountTypeEnum = z.enum([
  "depository",
  "investment",
  "credit",
  "loan",
  "real_estate",
  "alternative",
]);

const filingStatusEnum = z.enum([
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
]);

const employmentTypeEnum = z.enum([
  "w2",
  "self_employed",
  "1099",
  "business_owner",
]);

const riskToleranceEnum = z.enum([
  "conservative",
  "moderate_conservative",
  "moderate",
  "moderate_aggressive",
  "aggressive",
]);

// ─────────────────────────────────────────────────────────────────────────────
// LLM-facing schema (lenient).
//
// Bedrock-via-OpenRouter rejects several JSON-schema constructs that
// zod-to-json-schema produces by default:
//   - `propertyNames` (from z.record)
//   - `["string", "null"]` tuple types (from .nullable() / .nullish())
//   - `minimum`/`maximum` on integer types (from .int())
//   - `default` values
//   - some min/max length constraints
//
// We use plain `.optional()` everywhere here so omitted fields are valid and
// no `null` union ever appears in the schema. The LLM is instructed to OMIT
// fields it can't determine. Strict validation happens on /commit.
// ─────────────────────────────────────────────────────────────────────────────

const llmProfileSchema = z.object({
  name: z.string().optional(),
  age: z.number().optional(),
  dateOfBirth: z.string().optional(),
  annualIncome: z.number().optional(),
  filingStatus: filingStatusEnum.optional(),
  stateOfResidence: z.string().optional(),
  employmentType: employmentTypeEnum.optional(),
  riskTolerance: riskToleranceEnum.optional(),
  retirementAge: z.number().optional(),
  employerMatch: z.number().optional(),
  dependentCount: z.number().optional(),
  hasHDHP: z.boolean().optional(),
  isPSLFEligible: z.boolean().optional(),
});

const llmAccountSchema = z.object({
  name: z.string(),
  type: accountTypeEnum,
  subtype: z.string().optional(),
  balance: z.number().optional(),
  apr: z.number().optional(),
  apy: z.number().optional(),
  sourcePhrase: z.string(),
});

const llmGoalSchema = z.object({
  name: z.string(),
  targetAmount: z.number(),
  currentAmount: z.number().optional(),
  deadline: z.string().optional(),
  category: z.string().optional(),
  sourcePhrase: z.string(),
});

const llmResultSchema = z.object({
  profile: llmProfileSchema.optional(),
  accounts: z.array(llmAccountSchema),
  goals: z.array(llmGoalSchema),
  unparsed: z.array(z.string()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Commit-side schema (strict). Accepts both null and undefined for optional
// fields, normalizes on the way in.
// ─────────────────────────────────────────────────────────────────────────────

const commitProfileSchema = z
  .object({
    name: z.string().nullish(),
    dateOfBirth: z.string().nullish(),
    annualIncome: z.number().nullish(),
    filingStatus: filingStatusEnum.nullish(),
    stateOfResidence: z.string().nullish(),
    employmentType: employmentTypeEnum.nullish(),
    riskTolerance: riskToleranceEnum.nullish(),
    retirementAge: z.number().nullish(),
    employerMatch: z.number().nullish(),
    dependentCount: z.number().nullish(),
    hasHDHP: z.boolean().nullish(),
    isPSLFEligible: z.boolean().nullish(),
  })
  .nullish();

const commitAccountSchema = z.object({
  name: z.string().min(1),
  type: accountTypeEnum,
  subtype: z.string().nullish(),
  balance: z.number().nullish(),
  apr: z.number().nullish(),
  apy: z.number().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  sourcePhrase: z.string().optional().default(""),
});

const commitGoalSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number(),
  currentAmount: z.number().default(0),
  deadline: z.string().nullish(),
  category: z.string().default("savings"),
  sourcePhrase: z.string().optional().default(""),
});

const parseResultSchema = z.object({
  profile: commitProfileSchema,
  accounts: z.array(commitAccountSchema),
  goals: z.array(commitGoalSchema),
  unparsed: z.array(z.string()).default([]),
});

type ParseResult = z.infer<typeof parseResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// LLM prompt
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract structured personal finance data from a free-form description.

Today's date is {TODAY}.

Output JSON matching the provided schema. Be conservative — only emit fields the user clearly stated. OMIT any optional field you can't determine (do not output null — just leave the key out).

## Profile rules
- Name: "I'm Jonas" / "my name is Jonas" / "call me Jonas" → name "Jonas". Use the proper-case form even if user typed lowercase. Don't include last names unless the user clearly provided one.
- Age (PREFERRED for age statements): "I'm 35" / "35 years old" / "age 35" / "we're 35" → emit \`age: 35\` as a whole number. Do NOT compute dateOfBirth from an age — the server will do that with the correct current date.
- DateOfBirth (only for explicit dates): "born in 1989" / "born 1989-04-12" / "DOB 4/12/1989" → emit dateOfBirth as ISO YYYY-MM-DD. If only a year is given, use July 1 of that year.
- "Married" → filingStatus "married_joint" unless they say "filing separately"
- "Single" → "single"
- "X kids" or "X children" or "X dependents" → dependentCount: X
- State references like "in CA" or "live in Texas" → 2-letter code
- "$XXk salary" / "make $XXk" / "income of $XXk" → annualIncome
- "401k match of X%" → employerMatch: X
- "retire at NN" → retirementAge

## Account rules — emit ONE entry per account mentioned

### Investments / cash (one entry each)
- "brokerage with 1.8M" → { name: "Brokerage", type: "investment", subtype: "brokerage", balance: 1800000 }
- "Roth IRA of 725k" → { name: "Roth IRA", type: "investment", subtype: "roth_ira", balance: 725000 }
- "Traditional IRA 50k" / "IRA 50k" → subtype "ira"
- "401k of 220k" → subtype "401k"
- "403b" → subtype "403b"
- "HSA" → subtype "hsa"
- "checking 12k" / "savings 25k" → type "depository", subtype "checking" or "savings"
- "watch collection worth 30k" / "art collection" / "crypto" → type "alternative"

### Asset vs. loan — CRITICAL DISAMBIGUATION
An asset's value and a loan's balance are SEPARATE numbers. Never assign a stated dollar amount to both an asset and a loan.

- "primary residence 800k" / "home worth 800k" / "house valued at 800k" → ONE entry:
  real_estate, subtype "primary", balance: 800000  (this is the home's value, NOT a mortgage balance)
- "mortgage of 480k at 6.25%" / "$480k mortgage balance" → ONE entry:
  loan, subtype "mortgage", balance: 480000, apr: 6.25  (this is the loan balance)
- "$550k house at 5.75% mortgage rate" / "$550k home with a 5.75% mortgage" / "550k house, 5.75% rate" → TWO entries:
  1. real_estate, subtype "primary", balance: 550000  (the house value)
  2. loan, subtype "mortgage", balance: OMIT (user did NOT give the mortgage balance, only the rate), apr: 5.75
- "house worth 800k with 320k left on the mortgage at 5%" → TWO entries:
  1. real_estate, subtype "primary", balance: 800000
  2. loan, subtype "mortgage", balance: 320000, apr: 5

Rule of thumb: if the dollar amount sits next to "house/home/property/condo" (the asset noun), it's the asset value. If it sits next to "mortgage/loan/balance/owe" (the debt noun), it's the loan balance. If the user says "$X house at Y% rate", they gave you the asset value AND the loan rate but NOT the loan balance — emit both entries, omit the loan balance.

### Other debts
- "student loans 22k at 5%" → loan, subtype "student", balance: 22000, apr: 5
- "auto loan 18k" / "$18k car loan" / "car note of 18k" → loan, subtype "auto", balance: 18000
- "2 cars with 57k in car notes" / "$57k in auto loans" → ONE loan entry, subtype "auto", balance: 57000 (combined). Do NOT create asset entries for the cars themselves unless the user gives the cars' value.
- "credit card debt 4k" → type "credit", subtype: null, balance: 4000
- "rental property worth 400k with 200k mortgage" → TWO entries (same rule as primary):
  1. real_estate, subtype "rental", balance: 400000
  2. loan, subtype "mortgage", balance: 200000

### Format
- Numeric shorthand: k=1,000  M=1,000,000  ("1.8M" → 1800000, "725k" → 725000)
- name: use a short label the user would recognize (e.g., "Brokerage", "Roth IRA", "Mortgage", "Home")
- subtype: snake_case lowercase
- sourcePhrase: the literal phrase from the input that triggered this entry. For the two-entry asset+loan pattern, BOTH entries should share the same sourcePhrase.

## Goal rules
- "saving for X by YYYY" / "want $X for Y" → goal
- targetAmount required; deadline optional (ISO date or null)
- category: "savings" by default, or "retirement", "education", "house", "travel", "emergency", "debt"
- sourcePhrase: the literal phrase

## Unparsed
- If you heard something but couldn't map it to profile/accounts/goals, list the phrase in "unparsed".
- Examples: "love hiking", "have two cats", "thinking about a new car"

## Numbers
- Always emit numbers as JSON numbers, never strings.
- Never invent values not stated in the text.
- If balance/amount is missing for an account, OMIT the balance field (user will fill in).`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Convert "I'm 35" → a reasonable DOB. We don't know which side of their
// birthday they're on, so we estimate the midpoint: today minus age years
// minus 6 months. For someone who says they're 35 today, this yields a DOB
// that puts them roughly halfway through their 35th year.
function ageToDateOfBirth(age: number): string {
  const today = new Date();
  const dob = new Date(today.getFullYear() - age, today.getMonth() - 6, 1);
  return dob.toISOString().slice(0, 10);
}

async function getOrCreateManualItem(tenantId: string): Promise<string> {
  const existing = await db.query.plaidItems.findFirst({
    where: and(
      eq(plaidItems.tenantId, tenantId),
      eq(plaidItems.institutionId, "manual"),
    ),
  });
  if (existing) return existing.id;

  const [item] = await db
    .insert(plaidItems)
    .values({
      tenantId,
      accessToken: `manual-${Date.now()}`,
      institutionId: "manual",
      institutionName: "Manual Entry",
      status: "active",
      lastSyncedAt: new Date(),
    })
    .returning();
  return item.id;
}

async function loadCurrentProfile(tenantId: string, userId: string) {
  const [p, u] = await Promise.all([
    db.query.financialProfiles.findFirst({
      where: eq(financialProfiles.tenantId, tenantId),
    }),
    db.query.users.findFirst({
      where: eq(users.id, userId),
    }),
  ]);
  if (!p && !u?.name) return null;
  return {
    name: u?.name ?? null,
    dateOfBirth: p?.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    annualIncome: p?.annualIncome ? parseFloat(p.annualIncome) : null,
    filingStatus: p?.filingStatus ?? null,
    stateOfResidence: p?.stateOfResidence ?? null,
    employmentType: p?.employmentType ?? null,
    riskTolerance: p?.riskTolerance ?? null,
    retirementAge: p?.retirementAge ?? null,
    employerMatch:
      p?.employerMatch !== null && p?.employerMatch !== undefined
        ? parseFloat(p.employerMatch)
        : null,
    dependentCount: p?.dependentCount ?? null,
    hasHDHP: p?.hasHDHP ?? null,
    isPSLFEligible: p?.isPSLFEligible ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /parse — free text → structured ParseResult
// ─────────────────────────────────────────────────────────────────────────────

quickImportRoutes.post("/parse", async (c) => {
  const session = c.get("session");
  if (session.isDemo) {
    return c.json({ error: "Quick Import is not available in demo mode" }, 403);
  }

  const body = await c.req.json<{ text?: string }>();
  const text = body.text?.trim();
  if (!text || text.length < 10) {
    return c.json({ error: "Please describe your situation in a sentence or two." }, 400);
  }
  if (text.length > 8000) {
    return c.json({ error: "Description too long — please keep it under 8000 characters." }, 400);
  }

  let parseResult: ParseResult;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = SYSTEM_PROMPT.replace("{TODAY}", today);

    const result = await generateObject({
      model: getModel("fast-claude"),
      schema: llmResultSchema,
      system: systemPrompt,
      prompt: text,
    });

    // Convert age → dateOfBirth using the real current date. The LLM doesn't
    // know "today" reliably (training cutoff drifts), so we never let it
    // compute the DOB — we just take the integer age and convert it ourselves.
    const llmOut = result.object;
    const llmProfile = llmOut.profile;
    let dateOfBirth = llmProfile?.dateOfBirth;
    if (!dateOfBirth && llmProfile?.age !== undefined && llmProfile.age >= 0) {
      dateOfBirth = ageToDateOfBirth(llmProfile.age);
    }

    const profileOut = llmProfile
      ? {
          name: llmProfile.name,
          dateOfBirth,
          annualIncome: llmProfile.annualIncome,
          filingStatus: llmProfile.filingStatus,
          stateOfResidence: llmProfile.stateOfResidence,
          employmentType: llmProfile.employmentType,
          riskTolerance: llmProfile.riskTolerance,
          retirementAge: llmProfile.retirementAge,
          employerMatch: llmProfile.employerMatch,
          dependentCount: llmProfile.dependentCount,
          hasHDHP: llmProfile.hasHDHP,
          isPSLFEligible: llmProfile.isPSLFEligible,
        }
      : null;

    const normalized = parseResultSchema.parse({
      profile: profileOut,
      accounts: llmOut.accounts ?? [],
      goals: llmOut.goals ?? [],
      unparsed: llmOut.unparsed ?? [],
    });
    parseResult = normalized;
  } catch (err) {
    console.error("[Quick Import] parse error:", err);
    return c.json(
      {
        error:
          "Couldn't parse that description — try rephrasing with clearer amounts and account types.",
      },
      422,
    );
  }

  const currentProfile = await loadCurrentProfile(session.tenantId, session.userId);

  return c.json({ parseResult, currentProfile });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /commit — apply a user-edited ParseResult inside one transaction
// ─────────────────────────────────────────────────────────────────────────────

quickImportRoutes.post("/commit", async (c) => {
  const session = c.get("session");
  if (session.isDemo) {
    return c.json({ error: "Quick Import is not available in demo mode" }, 403);
  }

  const raw = await c.req.json();
  const parsed = parseResultSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.issues.slice(0, 5) },
      400,
    );
  }
  const { profile, accounts: acctRows, goals: goalRows } = parsed.data;

  // Reject accounts missing a balance — required before commit
  for (const a of acctRows) {
    if (a.balance === null || a.balance === undefined) {
      return c.json(
        { error: `Account "${a.name}" is missing a balance.` },
        400,
      );
    }
    if (a.balance < 0) {
      return c.json(
        { error: `Account "${a.name}" has a negative balance.` },
        400,
      );
    }
  }

  const createdAccounts: { id: string; name: string }[] = [];
  const createdGoals: { id: string; name: string }[] = [];
  let profileUpdated = false;

  await db.transaction(async (tx) => {
    // ── Accounts (+ initial balance snapshots) ────────────────────────────
    if (acctRows.length > 0) {
      // getOrCreateManualItem uses `db`, not `tx` — that's OK, it's a separate
      // upsert that's idempotent across runs.
      const plaidItemId = await getOrCreateManualItem(session.tenantId);

      for (const a of acctRows) {
        const metaObj = a.metadata ? { ...a.metadata } : {};
        const metaStr =
          Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : null;

        const [acct] = await tx
          .insert(accounts)
          .values({
            tenantId: session.tenantId,
            plaidItemId,
            plaidAccountId: `manual-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            name: a.name,
            type: a.type,
            subtype: a.subtype ?? null,
            mask: null,
            apr: a.apr !== null && a.apr !== undefined ? String(a.apr) : null,
            apy: a.apy !== null && a.apy !== undefined ? String(a.apy) : null,
            metadata: metaStr,
          })
          .returning();

        await tx.insert(balanceSnapshots).values({
          accountId: acct.id,
          tenantId: session.tenantId,
          balance: String(a.balance),
          isoCurrencyCode: "USD",
          snapshotAt: new Date(),
        });

        createdAccounts.push({ id: acct.id, name: acct.name });
      }
    }

    // ── Goals ────────────────────────────────────────────────────────────
    for (const g of goalRows) {
      const [goal] = await tx
        .insert(goals)
        .values({
          tenantId: session.tenantId,
          name: g.name,
          targetAmount: String(g.targetAmount),
          currentAmount: String(g.currentAmount ?? 0),
          deadline: g.deadline ? new Date(g.deadline) : undefined,
          category: g.category || "savings",
        })
        .returning();
      createdGoals.push({ id: goal.id, name: goal.name });
    }

    // ── Profile (merge non-null fields the client sent) ──────────────────
    if (profile) {
      // users.name lives on the user row, not financialProfiles
      if (profile.name && profile.name.trim()) {
        await tx
          .update(users)
          .set({ name: profile.name.trim() })
          .where(eq(users.id, session.userId));
        profileUpdated = true;
      }

      const values: Record<string, unknown> = {};
      if (profile.dateOfBirth)
        values.dateOfBirth = new Date(profile.dateOfBirth);
      if (profile.annualIncome !== null && profile.annualIncome !== undefined)
        values.annualIncome = String(profile.annualIncome);
      if (profile.filingStatus) values.filingStatus = profile.filingStatus;
      if (profile.stateOfResidence)
        values.stateOfResidence = profile.stateOfResidence;
      if (profile.employmentType) values.employmentType = profile.employmentType;
      if (profile.riskTolerance) values.riskTolerance = profile.riskTolerance;
      if (profile.retirementAge !== null && profile.retirementAge !== undefined)
        values.retirementAge = Math.round(profile.retirementAge);
      if (profile.employerMatch !== null && profile.employerMatch !== undefined)
        values.employerMatch = String(profile.employerMatch);
      if (profile.dependentCount !== null && profile.dependentCount !== undefined)
        values.dependentCount = Math.round(profile.dependentCount);
      if (profile.hasHDHP !== null && profile.hasHDHP !== undefined)
        values.hasHDHP = profile.hasHDHP;
      if (profile.isPSLFEligible !== null && profile.isPSLFEligible !== undefined)
        values.isPSLFEligible = profile.isPSLFEligible;

      if (Object.keys(values).length > 0) {
        const existing = await tx.query.financialProfiles.findFirst({
          where: eq(financialProfiles.tenantId, session.tenantId),
        });

        if (existing) {
          await tx
            .update(financialProfiles)
            .set(values)
            .where(eq(financialProfiles.tenantId, session.tenantId));
        } else {
          await tx
            .insert(financialProfiles)
            .values({ tenantId: session.tenantId, ...values });
        }
        profileUpdated = true;
      }
    }
  });

  return c.json({
    ok: true,
    created: { accounts: createdAccounts, goals: createdGoals },
    profileUpdated,
  });
});
