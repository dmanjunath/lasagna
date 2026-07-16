import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api.js";
import { setNativeToken } from "./native.js";
import { setPasskeyRegistered } from "./passkey-hint.js";

interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  onboardingStage: string | null;
  isAdmin: boolean;
  hasAcceptedTerms: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  notifyDaily: boolean;
  notifyBills: boolean;
  notifyWeeklyEmail: boolean;
}

interface Tenant {
  id: string;
  name: string;
  plan: string;
}

export type NeedsVerification = { needsVerification: true; email: string };

// Mirror of the last-known user/tenant so we can render the app shell
// optimistically on boot instead of a blank screen while /me is in flight.
// The HttpOnly session cookie is still the source of truth; this is a UI hint.
// /me corrects state if the hint is stale (logged out, role changed, etc.).
const HINT_KEY = "lf_auth_hint";

function loadAuthHint(): { user: User | null; tenant: Tenant | null } {
  if (typeof window === "undefined") return { user: null, tenant: null };
  try {
    const raw = window.localStorage.getItem(HINT_KEY);
    if (!raw) return { user: null, tenant: null };
    const parsed = JSON.parse(raw) as { user?: User; tenant?: Tenant | null };
    if (!parsed.user || !parsed.user.id || !parsed.user.email) {
      return { user: null, tenant: null };
    }
    return { user: parsed.user, tenant: parsed.tenant ?? null };
  } catch {
    return { user: null, tenant: null };
  }
}

function saveAuthHint(user: User | null, tenant: Tenant | null) {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(HINT_KEY, JSON.stringify({ user, tenant }));
    } else {
      window.localStorage.removeItem(HINT_KEY);
    }
  } catch {}
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<NeedsVerification | null>;
  loginWithPasskey: () => Promise<void>;
  signup: (email: string, password: string, name?: string, agreements?: { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }) => Promise<NeedsVerification | null>;
  logout: () => Promise<void>;
  updateTenant: (updates: Partial<Tenant>) => void;
  setOnboardingStage: (stage: string | null) => void;
  updateMe: (updates: { name?: string | null; notifyDaily?: boolean; notifyBills?: boolean; notifyWeeklyEmail?: boolean }) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate from the localStorage hint so the very first paint is meaningful.
  // The hint is replaced once /me confirms (or cleared if /me 401s).
  const [{ user, tenant }, setAuth] = useState<{ user: User | null; tenant: Tenant | null }>(() =>
    loadAuthHint(),
  );
  const [loading, setLoading] = useState(true);

  const commitAuth = useCallback((next: { user: User | null; tenant: Tenant | null }) => {
    setAuth(next);
    saveAuthHint(next.user, next.tenant);
  }, []);

  const fetchMe = useCallback(
    ({ keepOnError = false }: { keepOnError?: boolean } = {}) =>
      api
        .me()
        .then((data) => commitAuth({ user: data.user, tenant: data.tenant }))
        .catch(() => {
          // keepOnError: a transient failure (e.g. radio waking up on app
          // resume) must not visually log the user out — keep current state.
          // If the session genuinely expired, the next data fetch 401s and
          // routes to login normally.
          if (!keepOnError) commitAuth({ user: null, tenant: null });
        }),
    [commitAuth],
  );

  useEffect(() => {
    fetchMe().finally(() => setLoading(false));
  }, [fetchMe]);

  // Native shell: refetch /me when the app returns to the foreground, or when
  // the in-app browser sheet closes (Stripe checkout/portal) — so a plan change
  // made outside the WebView shows up (tenant.plan gates model access etc.).
  useEffect(() => {
    const onRefresh = () => { void fetchMe({ keepOnError: true }); };
    window.addEventListener("native:resume", onRefresh);
    window.addEventListener("native:browser-closed", onRefresh);
    return () => {
      window.removeEventListener("native:resume", onRefresh);
      window.removeEventListener("native:browser-closed", onRefresh);
    };
  }, [fetchMe]);

  const login = useCallback(async (email: string, password: string): Promise<NeedsVerification | null> => {
    const data = (await api.login({ email, password })) as any;
    if (data.needsVerification) return data as NeedsVerification;
    if (data.token) setNativeToken(data.token); // native shell: Bearer auth
    commitAuth({ user: data.user, tenant: data.tenant });
    return null;
  }, [commitAuth]);

  const loginWithPasskey = useCallback(async () => {
    // Lazy import — WebAuthn code only loads when a passkey flow starts.
    const { startAuthentication } = await import('@simplewebauthn/browser');
    const options = await api.webauthnLoginOptions();
    const response = await startAuthentication({ optionsJSON: options as never });
    // Same shape /login returns; cast like login() above (server omits notify prefs).
    const data = (await api.webauthnLoginVerify({ response })) as any;
    if (data.token) setNativeToken(data.token); // native shell: Bearer auth
    setPasskeyRegistered(true); // this device can do passkey login — offer it next time
    commitAuth({ user: data.user, tenant: data.tenant });
  }, [commitAuth]);

  const signup = useCallback(
    async (email: string, password: string, name?: string, agreements?: { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }): Promise<NeedsVerification | null> => {
      const data = (await api.signup({ email, password, name, acceptedTos: agreements?.acceptedTos ?? false, acceptedPrivacy: agreements?.acceptedPrivacy ?? false, acceptedNotRia: agreements?.acceptedNotRia ?? false })) as any;
      if (data.needsVerification) return data as NeedsVerification;
      commitAuth({ user: data.user, tenant: data.tenant });
      return null;
    },
    [commitAuth],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setNativeToken(null);
    commitAuth({ user: null, tenant: null });
  }, [commitAuth]);

  const updateTenant = useCallback((updates: Partial<Tenant>) => {
    setAuth((prev) => {
      const nextTenant = prev.tenant ? { ...prev.tenant, ...updates } : prev.tenant;
      saveAuthHint(prev.user, nextTenant);
      return { user: prev.user, tenant: nextTenant };
    });
  }, []);

  const setOnboardingStage = useCallback((stage: string | null) => {
    setAuth((prev) => {
      const nextUser = prev.user ? { ...prev.user, onboardingStage: stage } : prev.user;
      saveAuthHint(nextUser, prev.tenant);
      return { user: nextUser, tenant: prev.tenant };
    });
  }, []);

  const updateMe = useCallback(
    async (updates: { name?: string | null; notifyDaily?: boolean; notifyBills?: boolean; notifyWeeklyEmail?: boolean }) => {
      const { user: updated } = await api.updateMe(updates);
      setAuth((prev) => {
        saveAuthHint(updated, prev.tenant);
        return { user: updated, tenant: prev.tenant };
      });
    },
    [],
  );

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, loginWithPasskey, signup, logout, updateTenant, setOnboardingStage, updateMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
