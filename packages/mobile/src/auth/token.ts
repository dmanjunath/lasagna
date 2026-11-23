import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "lasagna_session";

// Held in memory too, so every request doesn't hit the Keychain.
let cached: string | null = null;

export function getToken(): string | null {
  return cached;
}

export async function loadToken(): Promise<string | null> {
  cached = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}
