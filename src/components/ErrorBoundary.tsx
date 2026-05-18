import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorLog';

/**
 * Top-level React error boundary.
 *
 * What this catches:
 *   • Render errors anywhere in the component tree.
 *   • Lifecycle errors (componentDidMount, etc.).
 *   • Errors in constructors of class components.
 *
 * What it does NOT catch (handled elsewhere by `installGlobalErrorReporting`):
 *   • Async / event handler errors → `window.error` listener.
 *   • Unhandled promise rejections → `unhandledrejection` listener.
 *
 * Recovery: shows a calm Thai message + a "ลองอีกครั้ง" button that
 * reloads the page. We deliberately *don't* attempt to clear state and
 * keep mounting — once React's reconciler has died on a subtree, trying
 * to render around it usually fails again. A clean reload is honest.
 */
interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorName: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorName: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorName: error?.name || 'Error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Report to backend so we see the error in Railway logs even if the
    // user closes the tab without reloading.
    reportError(error, { kind: 'boundary', componentStack: info.componentStack || undefined });
    // Mirror to the console for local dev — boundary catches swallow it
    // from devtools' "uncaught" stream otherwise.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid min-h-screen w-screen place-items-center bg-[#f4f1f9] p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-md shadow-brand-500/25" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-6 w-6">
              <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight">เกิดข้อผิดพลาดบางอย่าง</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ระบบส่งรายงานข้อผิดพลาดให้ทีมงานแล้ว ลองโหลดหน้าใหม่อีกครั้งนะคะ
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-brand-600 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-xl hover:shadow-brand-600/35 active:translate-y-0 active:scale-[0.98]"
          >
            โหลดหน้าใหม่
          </button>
        </div>
      </div>
    );
  }
}
