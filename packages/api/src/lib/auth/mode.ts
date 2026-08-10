import { WorkOS } from "@workos-inc/node";
import { env } from "../env.js";

export type AuthMode = "workos" | "local";

export function authMode(): AuthMode {
  return env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID ? "workos" : "local";
}

let _client: WorkOS | null = null;
export function getWorkos(): WorkOS {
  if (!_client) {
    _client = new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID });
  }
  return _client;
}
