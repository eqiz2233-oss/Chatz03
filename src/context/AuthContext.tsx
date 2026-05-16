import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  displayName: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  /** Which OAuth provider seeded this account (if any). */
  oauthProvider?: 'google' | 'facebook' | null;
  /** The active shop id stored in the session cookie (server-side). */
  activeShopId?: string | null;
}

export interface SignupInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
}

type AuthResult = { ok: true } | { ok: false; error: string };

/** One row from `/api/auth/me`'s `shops` array — a shop the current user is a member of. */
export interface ShopMembership {
  id: string;
  slug: string;
  name: string;
  /** owner | staff (etc.) — the user's role on THIS shop, not their global role. */
  role: string;
  created_at?: string;
}

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  shops: ShopMembership[];
  activeShop: ShopMembership | null;
  login: (username: string, password: string) => Promise<AuthResult>;
  signup: (input: SignupInput) => Promise<AuthResult>;
  loginWithGoogle: (credential: string) => Promise<AuthResult>;
  loginWithFacebook: (accessToken: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Switch the current session's active shop. Resolves once the server confirms. */
  setActiveShop: (shopId: string) => Promise<AuthResult>;
}

interface MeResponse {
  user: AuthUser | null;
  shops?: ShopMembership[];
  activeShop?: ShopMembership | null;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [shops, setShops] = useState<ShopMembership[]>([]);
  const [activeShop, setActiveShopState] = useState<ShopMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include' });
      if (!r.ok) {
        setUser(null);
        setShops([]);
        setActiveShopState(null);
        return;
      }
      const d = (await r.json()) as MeResponse;
      setUser(d.user || null);
      setShops(Array.isArray(d.shops) ? d.shops : []);
      setActiveShopState(d.activeShop || null);
    } catch {
      setUser(null);
      setShops([]);
      setActiveShopState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Shared "POST a body, expect a session cookie, refresh state" helper for
   *  the four auth-entry endpoints (login, signup, google, facebook). */
  const postAuth = useCallback(
    async (path: string, body: object): Promise<AuthResult> => {
      try {
        const r = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { ok: false, error: j?.error || `HTTP ${r.status}` };
        }
        // Refresh from /api/auth/me so we get user + shops + activeShop in one shot.
        await refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message || e) };
      }
    },
    [refresh],
  );

  const login = useCallback(
    (username: string, password: string) => postAuth('/api/auth/login', { username, password }),
    [postAuth],
  );

  const signup = useCallback(
    (input: SignupInput) => postAuth('/api/auth/signup', input),
    [postAuth],
  );

  const loginWithGoogle = useCallback(
    (credential: string) => postAuth('/api/auth/oauth/google', { credential }),
    [postAuth],
  );

  const loginWithFacebook = useCallback(
    (accessToken: string) => postAuth('/api/auth/oauth/facebook', { accessToken }),
    [postAuth],
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    setUser(null);
    setShops([]);
    setActiveShopState(null);
  }, []);

  const setActiveShop = useCallback(
    async (shopId: string) => {
      try {
        const r = await fetch('/api/auth/active-shop', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopId }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { ok: false as const, error: j?.error || `HTTP ${r.status}` };
        }
        const next = shops.find((s) => s.id === shopId) || null;
        setActiveShopState(next);
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: String((e as Error)?.message || e) };
      }
    },
    [shops],
  );

  const value = useMemo<AuthValue>(
    () => ({
      user, loading, shops, activeShop,
      login, signup, loginWithGoogle, loginWithFacebook,
      logout, refresh, setActiveShop,
    }),
    [user, loading, shops, activeShop, login, signup, loginWithGoogle, loginWithFacebook, logout, refresh, setActiveShop],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
