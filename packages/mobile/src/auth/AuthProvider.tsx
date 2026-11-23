import CookieManager from "@preeternal/react-native-cookie-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi, type Session, type Tenant, type User } from "@/api/auth";
import { ApiError, onUnauthorized } from "@/api/client";
import { clearFaceIdOnSignOut } from "./biometric";
import { loadToken, setToken } from "./token";

// Last-known user, so a signed-in launch paints the app at once while /auth/me
// is in flight. The Keychain token is the source of truth.
const HINT_KEY = "lf_auth_hint";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  user: User | null;
  tenant: Tenant | null;
  /** Stores a session returned by any sign-in call. */
  completeSignIn: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

  const clear = useCallback(async () => {
    await setToken(null);
    await AsyncStorage.removeItem(HINT_KEY).catch(() => {});
    // The web fallback's session cookie, so a later sign-in never shows the last
    // account's pages. Not awaited: the WebKit store's completion can stall.
    CookieManager.clearAll(true).catch(() => {});
    qc.clear();
    setUser(null);
    setTenant(null);
    setStatus("signedOut");
  }, [qc]);

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      setUser(me.user);
      setTenant(me.tenant);
      setStatus("signedIn");
      AsyncStorage.setItem(HINT_KEY, JSON.stringify(me)).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await clear();
      // Offline or server down: keep the hinted session and let screens show their own errors.
    }
  }, [clear]);

  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) return setStatus("signedOut");
      const hint = await AsyncStorage.getItem(HINT_KEY).catch(() => null);
      if (hint) {
        const parsed = JSON.parse(hint) as { user: User; tenant: Tenant | null };
        setUser(parsed.user);
        setTenant(parsed.tenant);
        setStatus("signedIn");
      }
      await refresh();
      setStatus((s) => (s === "loading" ? "signedOut" : s));
    })();
  }, [refresh]);

  useEffect(() => {
    const off = onUnauthorized(() => void clear());
    return () => {
      off();
    };
  }, [clear]);

  const completeSignIn = useCallback(
    async (s: Session) => {
      if (!s.token) throw new Error("Sign-in did not return a session.");
      await setToken(s.token);
      setUser(s.user);
      setTenant(s.tenant);
      setStatus("signedIn");
      AsyncStorage.setItem(HINT_KEY, JSON.stringify({ user: s.user, tenant: s.tenant })).catch(() => {});
      void refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {});
    // Face ID is device-local state tied to being signed in, as on the web: the
    // lock goes off and the one-time offer is re-armed. The passkey hint stays.
    clearFaceIdOnSignOut();
    await clear();
  }, [clear]);

  const value = useMemo(() => ({ status, user, tenant, completeSignIn, signOut, refresh }), [status, user, tenant, completeSignIn, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
