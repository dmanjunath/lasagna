import { z } from "zod";
import { generateObject } from "ai";
import {
  and,
  eq,
  inArray,
  holdings,
  securities,
  securityClassifications,
  tenants,
  getTickerCategory,
  coerceAssetClass,
  ASSET_CLASSES,
  type AssetClass,
} from "@lasagna/core";
import { db } from "./db.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "./activity.js";

// Fast, cheap classifier model — small/quick and already configured. Given just
// a symbol plus whatever name/type metadata Plaid gives us, it slots the
// security into the app's existing asset-class taxonomy.
const CLASSIFIER_LEVEL = "fast" as const;

// Throttle: a given tenant's post-sync classification batch runs at most once
// per this window, so a chatty sync loop can't hammer the model.
const THROTTLE_MS = 24 * 60 * 60 * 1000;

// Cap the securities classified in a single batch so one sync never fans out an
// unbounded number of model calls.
const MAX_PER_BATCH = 25;

// Constrain the model to the taxonomy: it must return one of the exact asset
// classes, a short sub-category label, and a confidence it's willing to stand
// behind. Low confidence is treated as "couldn't classify".
const classificationSchema = z.object({
  assetClass: z.enum(ASSET_CLASSES as unknown as [AssetClass, ...AssetClass[]]),
  category: z
    .string()
    .max(60)
    .describe("Short sub-category label, e.g. 'Individual Stocks' or 'ETFs'."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are, 0-1."),
});

const CONFIDENCE_FLOOR = 0.6;

const SYSTEM_PROMPT = `You classify a single investment security into a fixed asset-class taxonomy for a personal-finance app.

Allowed asset classes (you MUST return one of these exactly):
- "US Stocks" — US-listed equities, US equity ETFs/funds
- "International Stocks" — non-US equities and international equity funds
- "Bonds" — bond funds, fixed income, treasury/corporate/muni bond funds
- "REITs" — real estate investment trusts and REIT funds
- "Cash" — money-market funds, cash, cash-equivalents
- "Other" — crypto, commodities, options/derivatives, or anything you cannot confidently place

Rules:
- Return the single best asset class from the list above, verbatim.
- "category" is a short human label for the sub-type (e.g. "Individual Stocks", "ETFs", "Bond Funds", "Money Market", "Crypto").
- Only use a confidence at or above 0.6 when you genuinely recognize the security. If the symbol is unfamiliar or ambiguous, return "Other" with a low confidence.
- Do not invent asset classes outside the list.`;

export interface ClassifierInput {
  symbol: string;
  name?: string | null;
  securityType?: string | null;
}

/**
 * Classify one security via the fast model, constrained to the asset-class
 * taxonomy. Returns a validated {assetClass, category} or null when the model
 * output is invalid, low-confidence, or the call fails. Never throws — a null
 * result means "leave the security as-is / negative cache".
 */
export async function classifySecurity(
  input: ClassifierInput
): Promise<{ assetClass: AssetClass; category: string } | null> {
  const prompt = [
    `Symbol: ${input.symbol}`,
    input.name ? `Name: ${input.name}` : null,
    input.securityType ? `Plaid security type: ${input.securityType}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  let result;
  try {
    result = await generateObject({
      model: getModel(CLASSIFIER_LEVEL),
      schema: classificationSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      maxOutputTokens: 200,
    });
  } catch (e) {
    console.error(
      `[security-classify] model call failed for ${input.symbol}:`,
      e instanceof Error ? e.message : e
    );
    return null;
  }

  logLlmUsage({
    tenantId: null,
    source: "security-classify",
    model: getModelSlug(CLASSIFIER_LEVEL),
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });

  const out = result.object;

  // Validate against the enum even though the schema constrains it — the model
  // can still return a low-confidence or off-taxonomy answer, and we never want
  // to cache a garbage asset class.
  const assetClass = coerceAssetClass(out.assetClass);
  if (!assetClass || out.confidence < CONFIDENCE_FLOOR) {
    return null;
  }

  const category = out.category.trim().slice(0, 60) || "Unknown";
  return { assetClass, category };
}

/**
 * After a Plaid sync, classify this tenant's still-unknown securities via the
 * fast model and cache the results GLOBALLY (keyed by symbol) so every user
 * holding the same security reuses them. Throttled to once per 24h per tenant.
 *
 * Fire-and-forget from the sync path: this must never throw, so a classifier
 * failure can't break or block the sync. A failed lookup just leaves the
 * security as-is and is negative-cached so we don't retry it every sync.
 */
export async function classifyUnknownSecuritiesForTenant(
  tenantId: string
): Promise<void> {
  try {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });
    if (!tenant) return;

    // 24h per-tenant throttle.
    const last = tenant.lastSecurityClassifyAt;
    if (last && Date.now() - last.getTime() < THROTTLE_MS) {
      return;
    }
    // Stamp the run up front so concurrent syncs don't double-run the batch.
    await db
      .update(tenants)
      .set({ lastSecurityClassifyAt: new Date() })
      .where(eq(tenants.id, tenantId));

    // Distinct securities this tenant currently holds.
    const held = await db
      .selectDistinct({ securityId: holdings.securityId })
      .from(holdings)
      .where(eq(holdings.tenantId, tenantId));
    const securityIds = held.map((h) => h.securityId);
    if (securityIds.length === 0) return;

    const secs = await db.query.securities.findMany({
      where: inArray(securities.id, securityIds),
    });

    // Keep only securities the hardcoded map can't already place (the ones the
    // portfolio hero would otherwise show as Other/Unknown), that have a symbol.
    const unknown = secs.filter((s) => {
      const symbol = s.tickerSymbol?.trim();
      if (!symbol) return false;
      return getTickerCategory(symbol).assetClass === "Other";
    });
    if (unknown.length === 0) return;

    // Dedupe by uppercased symbol — securities are shared, so we classify each
    // symbol once regardless of how many security rows reference it.
    const bySymbol = new Map<string, (typeof unknown)[number]>();
    for (const s of unknown) {
      const key = s.tickerSymbol!.trim().toUpperCase();
      if (!bySymbol.has(key)) bySymbol.set(key, s);
    }
    const symbols = [...bySymbol.keys()];

    // Skip symbols already cached and still fresh — negative caches count, so a
    // failed classification isn't retried until it ages past the throttle.
    const staleBefore = new Date(Date.now() - THROTTLE_MS);
    const existing = await db.query.securityClassifications.findMany({
      where: inArray(securityClassifications.symbol, symbols),
    });
    const freshCached = new Set(
      existing
        .filter((row) => row.classifiedAt >= staleBefore)
        .map((row) => row.symbol)
    );

    const todo = symbols
      .filter((sym) => !freshCached.has(sym))
      .slice(0, MAX_PER_BATCH);

    for (const symbol of todo) {
      const sec = bySymbol.get(symbol)!;
      const classified = await classifySecurity({
        symbol,
        name: sec.name,
        securityType: sec.type,
      });

      // Upsert the global cache — write negatives too (failed=true) so we don't
      // re-query a symbol the model couldn't place until it goes stale.
      const values = classified
        ? {
            symbol,
            assetClass: classified.assetClass,
            category: classified.category,
            failed: false,
            classifiedAt: new Date(),
          }
        : {
            symbol,
            assetClass: null,
            category: null,
            failed: true,
            classifiedAt: new Date(),
          };

      await db
        .insert(securityClassifications)
        .values(values)
        .onConflictDoUpdate({
          target: securityClassifications.symbol,
          set: {
            assetClass: values.assetClass,
            category: values.category,
            failed: values.failed,
            classifiedAt: values.classifiedAt,
          },
        });
    }
  } catch (e) {
    // Swallow everything — classification must never break the sync.
    console.error(
      `[security-classify] batch failed for tenant ${tenantId}:`,
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Load the global classification cache for a set of symbols, returning a map of
 * uppercased symbol → successful classification. Negative (failed) caches are
 * omitted so callers fall back to the security-type heuristic. Used to feed the
 * portfolio hero's category resolution.
 */
export async function loadSecurityClassifications(
  symbols: string[]
): Promise<Map<string, { assetClass: AssetClass; category: string }>> {
  const upper = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const map = new Map<string, { assetClass: AssetClass; category: string }>();
  if (upper.length === 0) return map;

  const rows = await db.query.securityClassifications.findMany({
    where: and(
      inArray(securityClassifications.symbol, upper),
      eq(securityClassifications.failed, false),
    ),
  });
  for (const row of rows) {
    const assetClass = coerceAssetClass(row.assetClass);
    if (!assetClass) continue;
    map.set(row.symbol, { assetClass, category: row.category || "Unknown" });
  }
  return map;
}
