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
  /** The active shop id stored in the session cookie (server-side). */
  activeShopId?: string | null;
}

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
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Switch the current session's active shop. Resolves once the server confirms. */
  setActiveShop: (shopId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          return { ok: false as const, error: j?.error || `HTTP ${r.status}` };
        }
        // Refresh from /api/auth/me so we get user + shops + activeShop in one shot.
        await refresh();
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: String((e as Error)?.message || e) };
      }
    },
    [refresh],
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
    () => ({ user, loading, shops, activeShop, login, logout, refresh, setActiveShop }),
    [user, loading, shops, activeShop, login, logout, refresh, setActiveShop],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
