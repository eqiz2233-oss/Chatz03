import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppPreferencesProvider } from './context/AppPreferencesContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorReporting } from './lib/errorLog';
import './index.css';

// Wire up global error reporting before anything else mounts so the very
// first paint is observable too.
installGlobalErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppPreferencesProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </AppPreferencesProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
