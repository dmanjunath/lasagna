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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setUser(data.user);
        setTenant(data.tenant);
      })
      .catch(() => {
        setUser(null);
        setTenant(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = (await api.login({ email, password })) as {
      user: User;
      tenant: Tenant | null;
    };
    setUser(data.user);
    setTenant(data.tenant);
  }, []);

  const signup = useCallback(
    async (email: string, password: string, name?: string, agreements?: { acceptedTos: boolean; acceptedPrivacy: boolean; acceptedNotRia: boolean }) => {
      const data = (await api.signup({ email, password, name, acceptedTos: agreements?.acceptedTos ?? false, acceptedPrivacy: agreements?.acceptedPrivacy ?? false, acceptedNotRia: agreements?.acceptedNotRia ?? false })) as {
        user: User;
        tenant: Tenant | null;
      };
      setUser(data.user);
      setTenant(data.tenant);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setTenant(null);
  }, []);

  const updateTenant = useCallback((updates: Partial<Tenant>) => {
    setTenant((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  const setOnboardingStage = useCallback((stage: string | null) => {
    setUser((prev) => (prev ? { ...prev, onboardingStage: stage } : prev));
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
