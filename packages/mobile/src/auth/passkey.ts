import AsyncStorage from "@react-native-async-storage/async-storage";

// ── The device hint (packages/web/src/lib/passkey-hint.ts) ────────────────
// A passkey usable on this device exists, so sign-in offers "Sign in with Face
// ID" only once it can succeed. Set after a passkey registration or sign-in.
const HINT_KEY = "lasagna_passkey_registered";

export async function hasRegisteredPasskey(): Promise<boolean> {
  return (await AsyncStorage.getItem(HINT_KEY).catch(() => null)) === "1";
}

export function setPasskeyRegistered(on: boolean) {
  (on ? AsyncStorage.setItem(HINT_KEY, "1") : AsyncStorage.removeItem(HINT_KEY)).catch(() => {});
}

// ── WebAuthn JSON between the API and the native passkey module ───────────
// The API (@simplewebauthn/server) speaks base64url JSON, and so does
// react-native-passkeys. These keep every binary field base64url both ways,
// whichever alphabet arrives, and fill the fields the server reads.

/** base64 or base64url in, unpadded base64url out. */
export function toBase64Url(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Json = Record<string, unknown>;
type Cred = { id: string; type?: string; transports?: string[] };

const credList = (list: unknown) =>
  Array.isArray(list) ? (list as Cred[]).map((c) => ({ ...c, id: toBase64Url(c.id), type: c.type ?? "public-key" })) : undefined;

/** Registration options from POST /auth/webauthn/register/options, as the native module takes them. */
export function toCreateRequest(options: Json) {
  const user = options.user as { id: string; name: string; displayName: string };
  const rp = options.rp as { id?: string; name: string };
  return {
    ...options,
    challenge: toBase64Url(String(options.challenge)),
    rp,
    user: { ...user, id: toBase64Url(user.id) },
    excludeCredentials: credList(options.excludeCredentials),
  } as never;
}

/** Sign-in options from POST /auth/webauthn/login/options, as the native module takes them. */
export function toGetRequest(options: Json) {
  return {
    ...options,
    challenge: toBase64Url(String(options.challenge)),
    allowCredentials: credList(options.allowCredentials),
  } as never;
}

const b64 = (v: unknown) => (typeof v === "string" ? toBase64Url(v) : v);

/** The native module's result, as verifyRegistrationResponse / verifyAuthenticationResponse read it. */
export function toServerResponse(result: Json): Json {
  const response = (result.response ?? {}) as Json;
  const mapped: Json = {};
  // Every string in the response is binary (base64url). Lists and numbers pass through.
  for (const [k, v] of Object.entries(response)) mapped[k] = b64(v);
  return {
    ...result,
    id: b64(result.id),
    rawId: b64(result.rawId ?? result.id),
    type: "public-key",
    response: mapped,
    clientExtensionResults: result.clientExtensionResults ?? {},
  };
}

