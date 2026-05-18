/**
 * Lightweight client-side error reporting.
 *
 * Posts uncaught errors + unhandled promise rejections + ErrorBoundary
 * catches to the backend so they show up in Railway logs / our error
 * tracker of choice. No third-party dependency — when we're ready to wire
 * Sentry properly, this file becomes the place where we forward to it.
 *
 * Design choices:
 *   • Best-effort: never throw from inside the logger. If reporting fails,
 *     we eat the error so we don't recurse into more reports.
 *   • De-duplicate by `${name}::${message}::${stack[0]}` for 30 s — common
 *     mistakes (broken hook in a re-rendering tree) would otherwise flood.
 *   • Use `navigator.sendBeacon` when available so reports survive page-
 *     close. Fallback to fetch with keepalive.
 */

type ErrorKind = 'window' | 'promise' | 'boundary' | 'manual';

interface ErrorReport {
  kind: ErrorKind;
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  url: string;
  userAgent: string;
  at: string;
  /** App version pulled from `__APP_VERSION__` if injected by Vite at build. */
  version?: string;
}

const ENDPOINT = '/api/log/client-error';
const DEDUPE_MS = 30_000;
const seen = new Map<string, number>();

function fingerprint(name: string, message: string, stack?: string): string {
  const head = (stack || '').split('\n')[0] || '';
  return `${name}::${message}::${head}`.slice(0, 400);
}

function shouldSend(fp: string): boolean {
  const now = Date.now();
  const last = seen.get(fp);
  if (last && now - last < DEDUPE_MS) return false;
  seen.set(fp, now);
  // Keep map small.
  if (seen.size > 50) {
    for (const [k, t] of seen) {
      if (now - t > DEDUPE_MS) seen.delete(k);
    }
  }
  return true;
}

function send(report: ErrorReport) {
  try {
    const body = JSON.stringify(report);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } else {
      void fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* swallow */ });
    }
    // Also forward to Sentry if @sentry/browser is installed AND a DSN
    // is wired up at runtime (e.g. injected via index.html or env). This
    // is intentionally optional — the app must keep reporting via the
    // in-house endpoint even when Sentry isn't configured yet.
    forwardToSentry(report);
  } catch {
    /* swallow — never throw from the reporter */
  }
}

/**
 * Optional Sentry forwarder. Looks for either:
 *   • `window.Sentry?.captureException` (loaded via <script> tag), or
 *   • a future module-level `@sentry/browser` import.
 * If neither is present, this is a no-op. When you're ready to enable
 * Sentry, add the SDK script tag (or npm install + import) — no code
 * change here is required to make capture start working.
 */
function forwardToSentry(report: ErrorReport) {
  type SentryLike = {
    captureException?: (err: unknown, ctx?: { extra?: Record<string, unknown> }) => void;
    captureMessage?: (msg: string, ctx?: { extra?: Record<string, unknown> }) => void;
  };
  const w = window as unknown as { Sentry?: SentryLike };
  const s = w.Sentry;
  if (!s) return;
  try {
    const extra = {
      kind: report.kind,
      url: report.url,
      componentStack: report.componentStack,
      reportedAt: report.at,
    };
    // Reconstruct an Error so Sentry groups by stack — cheaper than
    // throwing/catching to capture a fresh one.
    if (report.stack && typeof s.captureException === 'function') {
      const e = new Error(report.message);
      e.name = report.name;
      e.stack = report.stack;
      s.captureException(e, { extra });
    } else if (typeof s.captureMessage === 'function') {
      s.captureMessage(`${report.name}: ${report.message}`, { extra });
    }
  } catch {
    /* swallow */
  }
}

function build(
  kind: ErrorKind,
  err: unknown,
  extras?: { componentStack?: string },
): ErrorReport {
  const e = err as Partial<Error> | undefined;
  return {
    kind,
    name: e?.name || (typeof err === 'string' ? 'StringError' : 'UnknownError'),
    message: e?.message || (typeof err === 'string' ? err : 'Unknown error'),
    stack: e?.stack,
    componentStack: extras?.componentStack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    at: new Date().toISOString(),
  };
}

/** Public: send a manual breadcrumb / error. */
export function reportError(err: unknown, extras?: { componentStack?: string; kind?: ErrorKind }) {
  const kind: ErrorKind = extras?.kind || 'manual';
  const report = build(kind, err, extras);
  const fp = fingerprint(report.name, report.message, report.stack);
  if (!shouldSend(fp)) return;
  send(report);
}

let installed = false;

/** Install global handlers (window error + unhandled rejection). Idempotent. */
export function installGlobalErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // event.error is the Error instance when available; some browsers only
    // give us the message string and (filename, lineno, colno).
    const err = event.error || event.message;
    const report = build('window', err);
    if (!report.stack && event.filename) {
      report.stack = `${event.filename}:${event.lineno || 0}:${event.colno || 0}`;
    }
    const fp = fingerprint(report.name, report.message, report.stack);
    if (shouldSend(fp)) send(report);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const report = build('promise', reason);
    const fp = fingerprint(report.name, report.message, report.stack);
    if (shouldSend(fp)) send(report);
  });
}
