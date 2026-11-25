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

/**
 * What a "couldn't load" screen says, from the actual failure. A phone that
 * can't reach the server is told so, never that the fault is on our side.
 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Can't reach LasagnaFi. Check your connection and try again.";
    if (e.status >= 500) return "This is on our side, so trying again usually works.";
  }
  return "Something went wrong. Try again in a moment.";
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
  const send = () =>
    fetch(`${API_URL}/api${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-lasagna-client": "native",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });
  let res: Response;
  try {
    res = await send();
  } catch {
    // iOS hands back a connection the system already dropped when the app
    // returns from the background ("network connection was lost"). The
    // request never reached the server, so one immediate retry on a fresh
    // connection is safe, and it is what usually succeeds.
    try {
      await new Promise((r) => setTimeout(r, 250));
      res = await send();
    } catch {
      throw new ApiError("Cannot reach the server. Please check your connection.", 0);
    }
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

/**
 * Whether a failed query should try again: a dropped connection or a server
 * error is worth up to three more tries, a request the server refused (4xx)
 * never is, since the answer would not change.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  if (error instanceof ApiError) return error.status === 0 || error.status >= 500;
  return true;
}

/** 0.4s, 1.2s, 2.4s between tries. */
export function retryDelay(attempt: number): number {
  return [400, 1200, 2400][Math.min(attempt, 2)];
}
