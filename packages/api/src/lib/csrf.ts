import { resolveCorsOrigin } from "./cors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Decide whether a request is a cross-site forgery attempt and must be rejected.
 *
 * CORS alone does not stop this. CORS stops the attacker *reading* the response;
 * the write still lands. And a "simple" content type (text/plain, form-encoded)
 * skips the preflight entirely, while `c.req.json()` parses the body regardless
 * of what Content-Type claims. So a foreign page could POST with nothing but the
 * ambient session cookie and have the handler run.
 *
 * The rule: an unsafe method that authenticates with the *cookie* must come from
 * an origin we recognise. Requests carrying no session cookie are not a CSRF
 * vector — a browser has no ambient credential to attach on the attacker's
 * behalf — so webhooks and Bearer clients pass through untouched.
 *
 * A cookie-bearing write with no Origin at all is allowed: browsers always send
 * Origin on a cross-site write, so its absence means a non-browser client, and
 * rejecting it would break curl and server-to-server tooling for no security
 * gain.
 *
 * Origin membership is delegated to resolveCorsOrigin so this and the CORS
 * layer can never disagree about which origins are ours.
 */
export function blocksAsCsrf(req: {
  method: string;
  origin: string | undefined;
  hasSessionCookie: boolean;
  allowedOrigins: string[];
  isDev: boolean;
}): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  if (!req.hasSessionCookie) return false;
  if (!req.origin) return false;
  return resolveCorsOrigin(req.origin, req.allowedOrigins, req.isDev) === undefined;
}
