/**
 * Decide the reflected CORS origin (with credentials). The native shells and the
 * configured production web origin(s) are always allowed. localhost:* and
 * *.trycloudflare.com are dev-only conveniences — reflecting them in production
 * with `credentials: true` would let *any* attacker-registered tunnel/localhost
 * origin make credentialed cross-origin requests and read the responses.
 */
export function resolveCorsOrigin(
  origin: string | undefined,
  allowedOrigins: string[],
  isDev: boolean,
): string | undefined {
  if (!origin) return origin;
  // Capacitor shells (iOS WKWebView / Android WebView) — Bearer auth, not cookies.
  if (origin === "capacitor://localhost" || origin === "https://localhost") return origin;
  if (allowedOrigins.includes(origin)) return origin;
  if (isDev && (origin.startsWith("http://localhost:") || origin.endsWith(".trycloudflare.com"))) {
    return origin;
  }
  return undefined;
}
