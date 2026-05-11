import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppPreferencesProvider } from './context/AppPreferencesContext';
import { AuthProvider } from './context/AuthContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppPreferencesProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </AppPreferencesProvider>
  </React.StrictMode>,
);
