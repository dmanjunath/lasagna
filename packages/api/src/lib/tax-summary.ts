/**
 * A plain-language description of what a household's tax documents show.
 *
 * The tax page used to open by promising savings. It now opens by describing
 * the person's situation, which is the one thing the uploaded documents can
 * actually support. Nothing here recommends anything: the Actions list below
 * the summary is where moves belong.
 *
 * GENERATION IS LAZY AND FINGERPRINT-KEYED. Reading the summary regenerates it
 * only when the documents (or the profile fields it reads) have changed since
 * the stored copy, so a page view normally costs nothing. Generating inline on
 * upload was the obvious alternative and is wrong: a five-file batch is five
 * sequential POSTs, so it would make five model calls and race itself to the
 * last write.
 *
 * NO advisory lock around the model call. `path-generator.ts` documents a
 * measured limit where a lock held across a generation starves the connection
 * pool; the worst a concurrent double-generation does here is pay twice and
 * store the same paragraph.
 *
 * RESILIENCE: never throws. A model failure returns the last stored summary
 * (or null), the same contract narrative-section.ts keeps for plan creates.
 */

import { createHash } from "node:crypto";
import { llmGenerateText } from "./llm.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "./activity.js";
import { db } from "./db.js";
import { taxDocuments, financialProfiles, eq, desc } from "@lasagna/core";
import { readHouseholdProfile } from "./profile-resolver.js";
import { normalizePunctuation } from "./insights-engine.js";

/**
 * Newest documents only. A household with hundreds of forms would otherwise
 * grow the prompt without bound, and a 2 to 3 sentence summary cannot say
 * anything about the 31st document anyway.
 */
const MAX_DOCUMENTS = 30;

/**
 * The hard bound on the summary. The prompt already asks for a short paragraph
 * and is not enforcement: told "400 characters at the very most", a twenty
 * document household came back with 763, and the hero this lands in has no
 * line clamp to absorb the overflow, so it simply grew past the phone.
 * Same reasoning as normalizePunctuation and the MAX_DOCUMENTS cap: the prompt
 * asks, deterministic code decides. The prompt asks for less than this, so the
 * clamp is a backstop and not the normal path.
 */
const MAX_SUMMARY_CHARS = 400;

/**
 * The longest run of whole sentences that fits the bound.
 *
 * Cuts only where a sentence already ended, so the result never breaks a word
 * and never trails a comma or an open bracket. A terminator counts as a
 * sentence end only when whitespace or the end of the text follows it, which is
 * what keeps "$1,234.56" from reading as one. A single sentence longer than the
 * whole budget offers no such cut, so that case falls back to the last whole
 * word and closes it with a period.
 */
export function clampToSentence(text: string, max: number = MAX_SUMMARY_CHARS): string {
  if (text.length <= max) return text;

  const ends = /[.!?](?=\s|$)/g;
  let cut = 0;
  for (let m = ends.exec(text); m !== null; m = ends.exec(text)) {
    if (m.index + 1 > max) break;
    cut = m.index + 1;
  }
  if (cut > 0) return text.slice(0, cut);

  const word = text
    .slice(0, max)
    .replace(/\s+\S*$/, "")
    .replace(/[^\p{L}\p{N}%)\]]+$/u, "");
  return word ? `${word}.` : "";
}

const TAX_SUMMARY_PROMPT = `You describe a person's tax situation from the documents they have uploaded. You do not advise them.

You are given their filing profile and the fields extracted from each of their tax documents, as JSON. Write a short plain-language description of what those documents show.

Rules:
- LENGTH IS A HARD LIMIT: 2 to 3 sentences, and 300 characters at the very most, counting spaces. This holds no matter how many documents you are given. With many documents, name the forms and the years as a group and give only the two or three largest figures. Anything past the limit is cut off before the reader sees it, so a fourth sentence is a sentence nobody reads.
- Describe ONLY what the documents and the profile contain. Never invent a figure, a form, an employer, or a year that is not in the data.
- Name the forms on file, the years they cover, and the largest figures they carry (wages, withholding, interest, distributions, deductions).
- If something a reader would expect is absent, say it is not on file rather than guessing at it.
- NO recommendations and NO advice of any kind. Do not tell the reader to do anything, do not use words like should, consider, review, adjust, open, increase, claim, or maximize, and do not name an opportunity.
- NEVER estimate tax owed, tax saved, or a refund, and never project a figure the documents do not state.
- Write plain sentences a non-expert reads once. No lists, no headings, no markdown.
- Never use em dashes, en dashes, middots, or semicolons. Write ranges as "X to Y".`;

interface SummaryDoc {
  id: string;
  updatedAt: Date;
  documentType: string | null;
  taxYear: number | null;
  fields: Record<string, unknown>;
  summary: string;
}

/** The profile fields the summary is allowed to describe. */
interface SummaryProfile {
  filingStatus: string | null;
  stateOfResidence: string | null;
  annualIncome: string | null;
  dependentCount: number | null;
}

/**
 * What the summary was written from. Any change to a document (added, deleted,
 * re-extracted, re-yeared) or to a described profile field moves it, and
 * nothing else does.
 */
function fingerprint(docs: SummaryDoc[], profile: SummaryProfile): string {
  const docPart = docs
    .map((d) => `${d.id}:${d.updatedAt.toISOString()}`)
    .sort()
    .join("|");
  const profilePart = [
    profile.filingStatus ?? "",
    profile.stateOfResidence ?? "",
    profile.annualIncome ?? "",
    profile.dependentCount ?? "",
  ].join("|");
  return createHash("sha256").update(`${docPart}#${profilePart}`).digest("hex");
}

async function store(
  tenantId: string,
  summary: string | null,
  taxSummaryFingerprint: string,
  generatedAt: Date | null,
): Promise<void> {
  const values = {
    taxSummary: summary,
    taxSummaryFingerprint,
    taxSummaryGeneratedAt: generatedAt,
  };
  await db
    .insert(financialProfiles)
    .values({ tenantId, ...values })
    .onConflictDoUpdate({ target: financialProfiles.tenantId, set: values });
}

/**
 * The tenant's tax summary, regenerating it first if the documents or profile
 * have moved since it was last written.
 */
export async function readTaxSummary(
  tenantId: string,
): Promise<{ summary: string | null; generatedAt: Date | null }> {
  const [rows, household] = await Promise.all([
    db
      .select({
        id: taxDocuments.id,
        updatedAt: taxDocuments.updatedAt,
        llmFields: taxDocuments.llmFields,
        llmSummary: taxDocuments.llmSummary,
        taxYear: taxDocuments.taxYear,
      })
      .from(taxDocuments)
      .where(eq(taxDocuments.tenantId, tenantId))
      .orderBy(desc(taxDocuments.createdAt))
      .limit(MAX_DOCUMENTS),
    readHouseholdProfile(tenantId),
  ]);

  const docs: SummaryDoc[] = rows.map((d) => {
    const fields = (d.llmFields ?? {}) as Record<string, unknown>;
    return {
      id: d.id,
      updatedAt: d.updatedAt,
      documentType: (fields.document_type || fields.form_type || null) as string | null,
      taxYear: d.taxYear,
      fields,
      summary: d.llmSummary,
    };
  });

  const profile: SummaryProfile = {
    filingStatus: household?.filingStatus ?? null,
    stateOfResidence: household?.stateOfResidence ?? null,
    annualIncome: household?.annualIncome ?? null,
    dependentCount: household?.dependentCount ?? null,
  };

  // Clamped on the way out as well as on the way in, so a summary written
  // before the bound existed is short from the next page view, not from the
  // next regeneration.
  const stored = {
    summary: household?.taxSummary ? clampToSentence(household.taxSummary) : null,
    generatedAt: household?.taxSummaryGeneratedAt ?? null,
  };

  const fp = fingerprint(docs, profile);
  if (household?.taxSummaryFingerprint === fp) return stored;

  // Nothing uploaded. Store the fingerprint anyway so the next read is also
  // free, and never pay a model to say there is nothing to describe.
  if (docs.length === 0) {
    try {
      await store(tenantId, null, fp, null);
    } catch (e) {
      console.error(`[TaxSummary] Could not clear summary: ${String(e).slice(0, 200)}`);
    }
    return { summary: null, generatedAt: null };
  }

  try {
    const payload = JSON.stringify({
      profile,
      documents: docs.map((d) => ({
        documentType: d.documentType,
        taxYear: d.taxYear,
        fields: d.fields,
        summary: d.summary,
      })),
    });

    const result = await llmGenerateText(
      { tenantId },
      {
        model: getModel("medium"),
        system: TAX_SUMMARY_PROMPT,
        prompt: `Here are the person's tax documents and filing profile:\n\n${payload}`,
        temperature: 0.2,
        maxOutputTokens: 400,
      },
    );
    logLlmUsage({
      tenantId,
      source: "tax-summary",
      model: getModelSlug("medium"),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      costUsd: result.costUsd,
    });

    const summary = clampToSentence(normalizePunctuation(result.text.trim()));
    if (!summary) return stored;

    const generatedAt = new Date();
    await store(tenantId, summary, fp, generatedAt);
    return { summary, generatedAt };
  } catch (e) {
    // The last good summary is better than an error: it still describes
    // documents the user has on file.
    console.error(
      `[TaxSummary] Generation failed for tenant ${tenantId}: ${
        e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
      }`,
    );
    return stored;
  }
}
