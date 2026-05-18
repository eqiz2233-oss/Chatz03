import { AuthIllustration } from './AuthIllustration';

/**
 * Split-screen wrapper used by both LoginView and RegisterView so the
 * two pages feel like one product. Form on the left, decorative
 * illustration card on the right (desktop only — mobile just shows the
 * form on a soft tinted background so we don't waste viewport).
 *
 * Layout is height-locked (`h-screen`) so the form *never* overflows on
 * the typical 720–900px laptop viewport — no scrolling on login. The
 * brand mark floats top-left without stealing vertical space from the
 * centered form.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative grid h-screen w-screen grid-cols-1 overflow-hidden bg-[#f4f1f9] text-slate-900 dark:bg-slate-950 dark:text-slate-100 md:grid-cols-[1fr_1fr] md:p-3 lg:p-4">
      {/* Left — form panel. Vertically centered, capped narrow so inputs
          don't sprawl on ultra-wide screens. */}
      <div className="relative flex min-h-0 flex-col justify-center overflow-y-auto px-6 py-6 md:px-10 md:py-6 lg:px-16">
        {/* Brand mark, floats top-left */}
        <a
          href="/login"
          className="absolute left-6 top-5 inline-flex items-center gap-2 md:left-10 md:top-5 lg:left-16"
        >
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-md shadow-brand-500/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </span>
          <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Chatz</span>
        </a>

        <div className="mx-auto w-full max-w-[360px]">{children}</div>
      </div>

      {/* Right — illustration card (desktop only) */}
      <div className="relative hidden overflow-hidden rounded-3xl shadow-2xl shadow-purple-900/10 md:block">
        <AuthIllustration />
      </div>
    </div>
  );
}
