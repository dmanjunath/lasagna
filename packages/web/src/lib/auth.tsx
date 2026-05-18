import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api.js";

interface User {
  id: string;
  email: string;
  role: string;
  onboardingStage: string | null;
}

interface Tenant {
  id: string;
  name: string;
  plan: string;
}

interface AuthState {
  user: User | null;
  tenant: Tenant | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string, agreements?: { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }) => Promise<void>;
  logout: () => Promise<void>;
  updateTenant: (updates: Partial<Tenant>) => void;
  setOnboardingStage: (stage: string | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [{ user, tenant }, setAuth] = useState<{ user: User | null; tenant: Tenant | null }>(() =>
    loadAuthHint(),
  );
  const [loading, setLoading] = useState(true);

  const commitAuth = useCallback((next: { user: User | null; tenant: Tenant | null }) => {
    setAuth(next);
    saveAuthHint(next.user, next.tenant);
  }, []);

  useEffect(() => {
    api
      .me()
      .then((data) => commitAuth({ user: data.user, tenant: data.tenant }))
      .catch(() => commitAuth({ user: null, tenant: null }))
      .finally(() => setLoading(false));
  }, [commitAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const data = (await api.login({ email, password })) as {
      user: User;
      tenant: Tenant | null;
    };
    commitAuth({ user: data.user, tenant: data.tenant });
  }, [commitAuth]);

  const signup = useCallback(
    async (email: string, password: string, name?: string, agreements?: { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }) => {
      const data = (await api.signup({ email, password, name, acceptedTos: agreements?.acceptedTos ?? false, acceptedPrivacy: agreements?.acceptedPrivacy ?? false, acceptedNotRia: agreements?.acceptedNotRia ?? false })) as {
        user: User;
        tenant: Tenant | null;
      };
      commitAuth({ user: data.user, tenant: data.tenant });
    },
    [commitAuth],
  );

  const logout = useCallback(async () => {
    await api.logout();
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

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, signup, logout, updateTenant, setOnboardingStage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
