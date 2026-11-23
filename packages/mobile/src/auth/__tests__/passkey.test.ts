import { toBase64Url, toCreateRequest, toGetRequest, toServerResponse } from "../passkey";
import { shouldLock, LOCK_GRACE_MS } from "../biometric";

jest.mock("expo-secure-store", () => ({ getItem: jest.fn(), setItem: jest.fn(), deleteItemAsync: jest.fn(), AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0 }));

test("base64 of any alphabet becomes unpadded base64url", () => {
  expect(toBase64Url("a+b/c==")).toBe("a-b_c");
  expect(toBase64Url("a-b_c")).toBe("a-b_c");
  expect(toBase64Url("YQ==")).toBe("YQ");
});

// Shaped like @simplewebauthn/server's generateRegistrationOptions output.
const regOptions = {
  rp: { name: "LasagnaFi", id: "app.example.test" },
  user: { id: "dXNlci0x", name: "a@example.test", displayName: "A" },
  challenge: "c2/9+w==",
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  timeout: 60000,
  attestation: "none",
  excludeCredentials: [{ id: "Y3JlZA==", transports: ["internal"] }],
  authenticatorSelection: { residentKey: "preferred", userVerification: "preferred", requireResidentKey: false },
  extensions: { credProps: true },
  hints: [],
};

test("registration options keep every field and normalise the binary ones", () => {
  const r = toCreateRequest(regOptions) as unknown as typeof regOptions;
  expect(r.challenge).toBe("c2_9-w");
  expect(r.user).toEqual({ id: "dXNlci0x", name: "a@example.test", displayName: "A" });
  expect(r.rp.id).toBe("app.example.test");
  expect(r.excludeCredentials).toEqual([{ id: "Y3JlZA", transports: ["internal"], type: "public-key" }]);
  expect(r.pubKeyCredParams).toEqual(regOptions.pubKeyCredParams);
  expect(r.authenticatorSelection).toEqual(regOptions.authenticatorSelection);
});

test("sign-in options with no allow list stay without one", () => {
  const r = toGetRequest({ rpId: "app.example.test", challenge: "YWJj+/==", allowCredentials: [], userVerification: "preferred" }) as unknown as Record<string, unknown>;
  expect(r.challenge).toBe("YWJj-_");
  expect(r.allowCredentials).toEqual([]);
  expect(r.rpId).toBe("app.example.test");
});

test("a native registration result becomes what verifyRegistrationResponse reads", () => {
  const out = toServerResponse({
    id: "a+b/",
    rawId: "a+b/",
    type: "public-key",
    response: { clientDataJSON: "eyJ0==", attestationObject: "o2N+", transports: ["internal", "hybrid"], publicKeyAlgorithm: -7 },
    authenticatorAttachment: "platform",
  });
  expect(out).toEqual({
    id: "a-b_",
    rawId: "a-b_",
    type: "public-key",
    response: { clientDataJSON: "eyJ0", attestationObject: "o2N-", transports: ["internal", "hybrid"], publicKeyAlgorithm: -7 },
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
  });
});

test("a native assertion fills rawId and extension results when missing", () => {
  const out = toServerResponse({
    id: "Y3JlZA",
    response: { clientDataJSON: "e30", authenticatorData: "YXV0aA==", signature: "c2ln", userHandle: "dXNlci0x" },
  });
  expect(out.rawId).toBe("Y3JlZA");
  expect(out.type).toBe("public-key");
  expect(out.clientExtensionResults).toEqual({});
  expect((out.response as Record<string, string>).authenticatorData).toBe("YXV0aA");
});

test("the lock follows the web's rules", () => {
  const base = { enabled: true, signedIn: true, now: 1_000_000 };
  expect(shouldLock({ ...base, backgroundedAt: null })).toBe(true);
  expect(shouldLock({ ...base, backgroundedAt: base.now - LOCK_GRACE_MS })).toBe(false);
  expect(shouldLock({ ...base, backgroundedAt: base.now - LOCK_GRACE_MS - 1 })).toBe(true);
  expect(shouldLock({ ...base, enabled: false, backgroundedAt: null })).toBe(false);
  expect(shouldLock({ ...base, signedIn: false, backgroundedAt: null })).toBe(false);
});
