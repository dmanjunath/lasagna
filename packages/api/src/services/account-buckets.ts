/** Tax-treatment bucket classification, shared by the readiness section and the
 *  deterministic schedule engine so both group accounts identically. */
export const BUCKET_ORDER = ["taxable", "deferred", "roth", "hsa"] as const;
export type Bucket = (typeof BUCKET_ORDER)[number];
export const BUCKET_LABELS: Record<Bucket, string> = {
  taxable: "Taxable", deferred: "Tax-deferred", roth: "Roth", hsa: "HSA",
};

function classifyBucket(type: string, subtype: string | null | undefined): Bucket {
  const st = ` ${(subtype || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const has = (...words: string[]) => words.some((w) => st.includes(` ${w} `));
  if (has("hsa", "health reimbursement arrangement")) return "hsa";
  if (type === "investment" && has("roth")) return "roth";
  return "taxable";
}
function isDeferred(type: string, subtype: string | null | undefined): boolean {
  if (type !== "investment") return false;
  const st = ` ${(subtype || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const has = (...words: string[]) => words.some((w) => st.includes(` ${w} `));
  if (has("roth")) return false;
  return has("401k","401a","403b","457b","457","ira","sep","simple","keogh","sarsep","pension","retirement","profit sharing plan","annuity");
}
export function bucketFor(type: string, subtype: string | null | undefined): Bucket {
  const base = classifyBucket(type, subtype);
  if (base !== "taxable") return base;
  return isDeferred(type, subtype) ? "deferred" : "taxable";
}

/** Accounts earmarked for someone else (529 / custodial / UTMA / Coverdell):
 *  tracked and grown, but NEVER drawn for the owner's retirement. */
const EARMARKED_RE = /\b529\b|custodial|utma|ugma|coverdell|\bkids?\b/i;
export function isEarmarked(name: string, subtype: string | null | undefined): boolean {
  return EARMARKED_RE.test(name) || EARMARKED_RE.test(subtype ?? "");
}

const INVESTABLE = new Set(["investment", "depository"]);
/** Sum positive investable account balances into the four tax buckets. */
export function bucketBalances(
  accts: Array<{ type: string; subtype: string | null; rawBalance: number }>,
): Record<Bucket, number> {
  const sums: Record<Bucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0 };
  for (const a of accts) {
    if (!INVESTABLE.has(a.type) || !(a.rawBalance > 0)) continue;
    sums[bucketFor(a.type, a.subtype)] += a.rawBalance;
  }
  return sums;
}
