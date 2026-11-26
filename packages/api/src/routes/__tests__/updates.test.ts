import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { clearUpdatesCache, updatesRoutes } from "../updates.js";

const app = new Hono().route("/updates", updatesRoutes);
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const MANIFEST = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-01-01T00:00:00.000Z",
  runtimeVersion: "rt1",
  launchAsset: { hash: "h", key: "k", contentType: "application/javascript", url: "https://example.test/b.hbc" },
  assets: [],
  metadata: {},
  extra: {},
};

const HEADERS = { "expo-protocol-version": "1", "expo-platform": "ios", "expo-runtime-version": "rt1" };
const get = (headers: Record<string, string> = {}) =>
  app.request("/updates/manifest", { headers: { ...HEADERS, ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
function pointer(status: number, body?: unknown) {
  fetchMock.mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

/** The one part of a multipart reply: its name, signature and body. */
async function part(res: Response) {
  const type = res.headers.get("content-type") ?? "";
  const boundary = type.split("boundary=")[1];
  const text = await res.text();
  const chunk = text.split(`--${boundary}`)[1];
  const [head, ...rest] = chunk.replace(/^\r\n/, "").split("\r\n\r\n");
  return {
    name: /name="([^"]+)"/.exec(head)?.[1],
    signature: /expo-signature: (.*)/.exec(head)?.[1],
    body: rest.join("\r\n\r\n").replace(/\r\n$/, ""),
  };
}

beforeEach(() => {
  clearUpdatesCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OTA_BASE_URL = "https://bucket.example.test";
  delete process.env.OTA_CODE_SIGNING_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /updates/manifest", () => {
  it("rejects an unknown protocol, platform or a missing runtime version", async () => {
    expect((await get({ "expo-protocol-version": "0" })).status).toBe(400);
    expect((await get({ "expo-platform": "web" })).status).toBe(400);
    expect((await app.request("/updates/manifest", { headers: { "expo-protocol-version": "1", "expo-platform": "ios" } })).status).toBe(400);
  });

  it("answers 204 when OTA is not configured, without fetching", async () => {
    delete process.env.OTA_BASE_URL;
    const res = await get();
    expect(res.status).toBe(204);
    expect(res.headers.get("expo-protocol-version")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 204 when nothing is published for the runtime version", async () => {
    pointer(404);
    expect((await get()).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledWith("https://bucket.example.test/rn/ios/rt1/latest.json", expect.anything());
  });

  it("sends the live manifest as a multipart reply", async () => {
    pointer(200, MANIFEST);
    const res = await get({ "expo-current-update-id": "someone-else" });
    expect(res.status).toBe(200);
    expect(res.headers.get("expo-sfv-version")).toBe("0");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");
    const p = await part(res);
    expect(p.name).toBe("manifest");
    expect(JSON.parse(p.body)).toEqual(MANIFEST);
    expect(p.signature).toBeUndefined();
  });

  it("says there is no update when the device already runs the live one", async () => {
    pointer(200, MANIFEST);
    const p = await part(await get({ "expo-current-update-id": MANIFEST.id }));
    expect(p.name).toBe("directive");
    expect(JSON.parse(p.body)).toEqual({ type: "noUpdateAvailable" });
  });

  it("signs what it sends when the app expects a signature", async () => {
    process.env.OTA_CODE_SIGNING_KEY = privateKey;
    pointer(200, MANIFEST);
    const p = await part(await get({ "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"' }));
    const sig = /sig="([^"]+)"/.exec(p.signature ?? "")?.[1] ?? "";
    expect(p.signature).toContain('keyid="main"');
    expect(createVerify("RSA-SHA256").update(p.body).verify(publicKey, sig, "base64")).toBe(true);
  });

  it("refuses to send unsigned when a signature is expected but no key is set", async () => {
    pointer(200, MANIFEST);
    expect((await get({ "expo-expect-signature": "sig" })).status).toBe(500);
  });

  it("rolls devices back to their embedded bundle, once", async () => {
    pointer(200, { directive: "rollBackToEmbedded", id: "x", createdAt: "2026-02-01T00:00:00.000Z" });
    const back = await part(await get({ "expo-current-update-id": "a", "expo-embedded-update-id": "b" }));
    expect(JSON.parse(back.body)).toEqual({ type: "rollBackToEmbedded", parameters: { commitTime: "2026-02-01T00:00:00.000Z" } });
    const done = await part(await get({ "expo-current-update-id": "b", "expo-embedded-update-id": "b" }));
    expect(JSON.parse(done.body)).toEqual({ type: "noUpdateAvailable" });
  });

  it("answers 502 when the pointer cannot be read", async () => {
    pointer(500);
    expect((await get()).status).toBe(502);
  });

  it("reads the pointer once per cache window", async () => {
    pointer(200, MANIFEST);
    await get();
    await get();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
