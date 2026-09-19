import { timingSafeEqual } from "node:crypto";

/** Header Cloudflare injects on every request it proxies to this origin. */
export const ORIGIN_AUTH_HEADER = "x-origin-auth";

/**
 * Paths reachable without going through Cloudflare. Exact matches only — a
 * prefix test would let /api/health/anything through.
 */
const EXEMPT_PATHS = new Set(["/api/health"]);

export type OriginAuthOutcome = "disabled" | "exempt" | "ok" | "unfronted";

/**
 * Decide whether a request actually arrived through Cloudflare.
 *
 * The API is reachable two ways: api.lasagnafi.com, which Cloudflare proxies,
 * and the run.app URL, which answers the internet directly. Anything Cloudflare
 * enforces — rate limits, WAF, bot rules — is worthless while the second path
 * exists, and Cloud Run's ingress setting cannot close it here because a custom
 * domain mapping is not a load balancer (restricting ingress would take
 * api.lasagnafi.com down along with run.app).
 *
 * So Cloudflare injects a shared secret header and this rejects requests
 * without it. Not as strong as a load balancer with Cloud Armor — it is a
 * shared secret, so rotate it — but it costs nothing and closes the bypass.
 *
 * Fail-open when unconfigured, so the code can ship before Cloudflare is
 * sending the header. `/cron/*` is deliberately out of scope: Cloud Scheduler
 * calls the run.app URL directly and has its own shared-secret guard.
 */
export function checkOriginAuth(req: {
  method: string;
  path: string;
  provided: string | undefined;
  expected: string | undefined;
}): OriginAuthOutcome {
  if (!req.expected) return "disabled";
  if (req.method.toUpperCase() === "OPTIONS") return "exempt";
  if (EXEMPT_PATHS.has(req.path)) return "exempt";
  if (!req.provided) return "unfronted";

  const a = Buffer.from(req.provided);
  const b = Buffer.from(req.expected);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (a.length !== b.length) return "unfronted";
  return timingSafeEqual(a, b) ? "ok" : "unfronted";
}
