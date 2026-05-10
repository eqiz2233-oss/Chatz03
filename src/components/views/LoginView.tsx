import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppPreferences } from '../../context/AppPreferencesContext';

export function LoginView() {
  const { login } = useAuth();
  const { t } = useAppPreferences();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await login(username.trim(), password);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error === 'invalid_credentials' ? t('login.errInvalid') : r.error);
    }
  };

  return (
    <div className="grid h-screen w-screen place-items-center bg-gradient-to-br from-brand-50 via-white to-brand-100 px-6 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 5l8 14 4-7 6-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Chatz</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{t('app.tagline')}</div>
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30"
        >
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t('login.title')}</h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('login.subtitle')}</p>

          <label className="mt-5 block">
            <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">{t('login.username')}</div>
            <input
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
              placeholder="admin"
              required
            />
          </label>

          <label className="mt-3 block">
            <div className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">{t('login.password')}</div>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
              placeholder="••••••••"
              required
            />
          </label>

          {err && (
            <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="btn-primary mt-5 w-full justify-center text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t('login.signingIn') : t('login.signIn')}
          </button>

          <p className="mt-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
            {t('login.defaultHint')}
          </p>
        </form>
      </div>
    </div>
  );
}
