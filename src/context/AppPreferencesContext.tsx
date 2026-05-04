import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Locale } from '../i18n/messages';
import { translate } from '../i18n/messages';

export type Theme = 'light' | 'dark';

const STORAGE_THEME = 'chatz-theme';
const STORAGE_LOCALE = 'chatz-locale';

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_THEME);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* ignore */
  }
  return 'light';
}

function readStoredLocale(): Locale {
  try {
    const v = localStorage.getItem(STORAGE_LOCALE);
    if (v === 'en' || v === 'th') return v;
  } catch {
    /* ignore */
  }
  return 'th';
}

interface AppPreferencesValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const AppPreferencesContext = createContext<AppPreferencesValue | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.lang = locale === 'th' ? 'th' : 'en';
    try {
      localStorage.setItem(STORAGE_THEME, theme);
      localStorage.setItem(STORAGE_LOCALE, locale);
    } catch {
      /* ignore */
    }
  }, [theme, locale]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo(
    () => ({ theme, setTheme, locale, setLocale, t }),
    [theme, setTheme, locale, setLocale, t],
  );

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
}

export function useAppPreferences(): AppPreferencesValue {
  const ctx = useContext(AppPreferencesContext);
  if (!ctx) throw new Error('useAppPreferences must be used within AppPreferencesProvider');
  return ctx;
}
