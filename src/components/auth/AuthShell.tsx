import { AuthIllustration } from './AuthIllustration';

/**
 * Split-screen wrapper used by both LoginView and RegisterView so the
 * two pages feel like one product. Form on the left, decorative
 * illustration card on the right (desktop only — mobile just shows the
 * form on a soft tinted background so we don't waste viewport).
 *
 * The brand mark floats top-left. The form content is centered
 * vertically inside the left column and capped at max-w-sm so the
 * inputs don't sprawl on ultra-wide screens.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen w-screen grid-cols-1 bg-[#f4f1f9] text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:grid-cols-[1fr_1fr] md:p-4">
      {/* Left — form panel */}
      <div className="relative flex flex-col justify-center px-6 py-12 md:px-12 lg:px-20">
        {/* Brand mark, floats top-left */}
        <a
          href="/login"
          className="absolute left-6 top-6 inline-flex items-center gap-2 md:left-12 md:top-8 lg:left-20"
        >
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-md shadow-brand-500/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Chatz</span>
        </a>

        <div className="mx-auto w-full max-w-sm">{children}</div>

        {/* Tiny legal line at the very bottom-left, only on desktop. */}
        <p className="pointer-events-none absolute bottom-4 left-6 hidden text-[11px] text-slate-400 dark:text-slate-600 md:block md:left-12 lg:left-20">
          © Chatz · ระบบแชทร้านค้าออนไลน์ไทย
        </p>
      </div>

      {/* Right — illustration card (desktop only) */}
      <div className="relative hidden overflow-hidden rounded-3xl shadow-2xl shadow-purple-900/10 md:block">
        <AuthIllustration />
      </div>
    </div>
  );
}
