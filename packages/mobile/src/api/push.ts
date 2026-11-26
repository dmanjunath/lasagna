import { request } from "./client";

// This device's push token, mirroring packages/web/src/lib/api.ts.
export const pushApi = {
  save: (token: string, platform: "ios" | "android") =>
    request<{ ok: true }>("/push/token", { method: "POST", body: JSON.stringify({ token, platform }) }),
  remove: (token: string) => request<{ ok: true }>("/push/token", { method: "DELETE", body: JSON.stringify({ token }) }),
};
