import { API_URL } from "@/config";
import { getToken } from "@/auth/token";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * What to tell a person when a save fails. A network or server failure says
 * so in plain words already. A request the server refused carries its own
 * technical reason ("categories must be category ids"), so `refused` speaks
 * for it instead (M-13).
 */
export function saveErrorText(e: unknown, refused: string): string {
  if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) return e.message;
  return refused;
}

// Listeners for a rejected session, so the auth layer can sign out once.
const unauthorized = new Set<() => void>();
export function onUnauthorized(cb: () => void) {
  unauthorized.add(cb);
  return () => unauthorized.delete(cb);
}

/** Mirrors request() in packages/web/src/lib/api.ts, authenticated by Bearer token. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-lasagna-client": "native",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  } catch {
    throw new ApiError("Cannot reach the server. Please check your connection.", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.status === 502 || res.status === 503) {
      throw new ApiError("Server is temporarily unavailable. Please try again.", res.status);
    }
    if (res.status === 401 && token && !path.startsWith("/auth/login")) unauthorized.forEach((f) => f());
    throw new ApiError(body.error || res.statusText || "Something went wrong.", res.status);
  }
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
