import { Hono } from "hono";
import { createSign, randomBytes } from "node:crypto";

// Over-the-air updates for the React Native app: the Expo Updates protocol v1
// (docs.expo.dev/technical-specs/expo-updates-1). Mounted at /updates, outside
// /api, so no user session is needed. Installed apps call it on launch and on
// return to the foreground.
//
// The publish script (packages/mobile/scripts/ota-publish.sh) writes each
// runtime version's live update to <OTA_BASE_URL>/rn/<platform>/<runtime>/latest.json,
// already a complete manifest, or a rollBackToEmbedded directive. This route
// only picks it, answers "no update" when the device already has it, and signs
// what it sends with OTA_CODE_SIGNING_KEY so the app accepts it.
export const updatesRoutes = new Hono();

type Latest = { id: string; createdAt: string; directive?: string; [k: string]: unknown };

// Every device asks on every launch, so the pointer is cached briefly. A
// publish reaches devices within this window.
const CACHE_MS = 15_000;
const cache = new Map<string, { at: number; value: Latest | null }>();

export function clearUpdatesCache() {
  cache.clear();
}

async function loadLatest(platform: string, runtime: string): Promise<Latest | null> {
  const base = process.env.OTA_BASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  const key = `${platform}/${runtime}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(`${base}/rn/${platform}/${encodeURIComponent(runtime)}/latest.json`, {
    headers: { "cache-control": "no-cache" },
  });
  // Nothing published for this runtime version yet is the normal case for a
  // fresh build, not an error.
  const value = res.status === 404 || res.status === 403 ? null : res.ok ? ((await res.json()) as Latest) : undefined;
  if (value === undefined) throw new Error(`OTA pointer fetch failed: ${res.status}`);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** The expo-signature value for a body: an RSA-SHA256 signature as an SFV dictionary. */
export function signBody(body: string, privateKey: string): string {
  const sig = createSign("RSA-SHA256").update(body, "utf8").sign(privateKey, "base64");
  return `sig="${sig}", keyid="main"`;
}

function multipart(parts: Array<{ name: string; body: string; signature?: string }>) {
  const boundary = `----lasagna-${randomBytes(12).toString("hex")}`;
  const chunks = parts.map((p) =>
    [
      `--${boundary}`,
      `content-disposition: form-data; name="${p.name}"`,
      "content-type: application/json; charset=utf-8",
      ...(p.signature ? [`expo-signature: ${p.signature}`] : []),
      "",
      p.body,
    ].join("\r\n"),
  );
  return { boundary, body: `${chunks.join("\r\n")}\r\n--${boundary}--\r\n` };
}

const COMMON = {
  "expo-protocol-version": "1",
  "expo-sfv-version": "0",
  "cache-control": "private, max-age=0",
};

updatesRoutes.get("/manifest", async (c) => {
  if (c.req.header("expo-protocol-version") !== "1") return c.text("Unsupported protocol version", 400);
  const platform = c.req.header("expo-platform");
  if (platform !== "ios" && platform !== "android") return c.text("Unsupported platform", 400);
  const runtime = c.req.header("expo-runtime-version");
  if (!runtime) return c.text("Missing runtime version", 400);

  let latest: Latest | null;
  try {
    latest = await loadLatest(platform, runtime);
  } catch (e) {
    console.error("[updates]", e instanceof Error ? e.message : e);
    return c.text("Update lookup failed", 502);
  }

  const currentId = c.req.header("expo-current-update-id");
  const embeddedId = c.req.header("expo-embedded-update-id");

  // What to send: nothing, the manifest, or a directive.
  let part: { name: "manifest" | "directive"; payload: unknown } | null;
  if (!latest) {
    part = null;
  } else if (latest.directive === "rollBackToEmbedded") {
    part = currentId && currentId === embeddedId
      ? { name: "directive", payload: { type: "noUpdateAvailable" } }
      : { name: "directive", payload: { type: "rollBackToEmbedded", parameters: { commitTime: latest.createdAt } } };
  } else if (currentId && currentId === latest.id) {
    part = { name: "directive", payload: { type: "noUpdateAvailable" } };
  } else {
    part = { name: "manifest", payload: latest };
  }

  if (!part) return c.body(null, 204, COMMON);

  const body = JSON.stringify(part.payload);
  let signature: string | undefined;
  if (c.req.header("expo-expect-signature")) {
    const key = process.env.OTA_CODE_SIGNING_KEY;
    if (!key) {
      console.error("[updates] a signature was asked for but OTA_CODE_SIGNING_KEY is not set");
      return c.text("Code signing not configured", 500);
    }
    signature = signBody(body, key.replace(/\\n/g, "\n"));
  }
  const out = multipart([{ name: part.name, body, signature }]);
  return c.body(out.body, 200, { ...COMMON, "content-type": `multipart/mixed; boundary=${out.boundary}` });
});
