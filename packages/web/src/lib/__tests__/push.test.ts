import { describe, it, expect, beforeEach, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  permission: "granted" as string,
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getToken: vi.fn(),
  addListener: vi.fn(),
}));

const api = vi.hoisted(() => ({
  savePushToken: vi.fn(),
  deletePushToken: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isPluginAvailable: () => true, getPlatform: () => "ios" },
}));
vi.mock("@capacitor-firebase/messaging", () => ({ FirebaseMessaging: plugin }));
vi.mock("../api", () => ({ api }));

let push: typeof import("../push");

beforeEach(async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  plugin.permission = "granted";
  plugin.checkPermissions.mockImplementation(async () => ({ receive: plugin.permission }));
  plugin.requestPermissions.mockImplementation(async () => ({ receive: plugin.permission }));
  plugin.getToken.mockResolvedValue({ token: "device-token" });
  plugin.addListener.mockResolvedValue({ remove: vi.fn() });
  api.savePushToken.mockReset().mockResolvedValue({ ok: true });
  api.deletePushToken.mockReset().mockResolvedValue({ ok: true });
  // registerPush keeps module state, so each case gets a fresh module.
  vi.resetModules();
  push = await import("../push");
});

describe("getPushState", () => {
  it("is blocked when iOS has notifications off", async () => {
    plugin.permission = "denied";
    expect(await push.getPushState()).toBe("blocked");
  });

  it("is off until the user has been asked", async () => {
    plugin.permission = "prompt";
    expect(await push.getPushState()).toBe("off");
  });

  it("is on when allowed and not turned off in Settings", async () => {
    expect(await push.getPushState()).toBe("on");
  });
});

describe("setPushEnabled", () => {
  it("turning off removes the token from the server and stops launch re-registering", async () => {
    await push.registerPush();
    expect(await push.setPushEnabled(false)).toBe("off");
    expect(api.deletePushToken).toHaveBeenCalledWith({ token: "device-token" });

    vi.resetModules();
    push = await import("../push"); // next launch
    await push.registerPush();
    expect(api.savePushToken).toHaveBeenCalledTimes(1);
  });

  it("stays on when the server can't remove the token", async () => {
    await push.registerPush();
    api.deletePushToken.mockRejectedValueOnce(new Error("offline"));
    await expect(push.setPushEnabled(false)).rejects.toThrow("offline");
    expect(await push.getPushState()).toBe("on");

    // The token is still known, so a retry can remove it.
    await push.setPushEnabled(false);
    expect(api.deletePushToken).toHaveBeenLastCalledWith({ token: "device-token" });
  });

  it("turning back on registers again", async () => {
    await push.registerPush();
    await push.setPushEnabled(false);
    expect(await push.setPushEnabled(true)).toBe("on");
    expect(api.savePushToken).toHaveBeenCalledTimes(2);
  });

  it("retries registration after a failed save", async () => {
    api.savePushToken.mockRejectedValueOnce(new Error("offline"));
    await expect(push.registerPush()).rejects.toThrow("offline");
    await push.registerPush();
    expect(api.savePushToken).toHaveBeenCalledTimes(2);
  });
});

describe("signOutPush", () => {
  it("lets the next account start with push on", async () => {
    await push.registerPush();
    await push.setPushEnabled(false);
    await push.signOutPush();
    expect(await push.getPushState()).toBe("on");
  });
});

describe("setPushEnabled failure", () => {
  it("stays off when turning on fails, including at the next launch", async () => {
    await push.registerPush();
    await push.setPushEnabled(false);
    api.savePushToken.mockRejectedValueOnce(new Error("offline"));
    await expect(push.setPushEnabled(true)).rejects.toThrow("offline");
    expect(await push.getPushState()).toBe("off");
  });
});
