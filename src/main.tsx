import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { I18nProvider } from './i18n/I18nContext.tsx';
import { PWAProvider, initPWABootstrapListeners } from './pwa/PWAContext.tsx';
import './index.css';

initPWABootstrapListeners();

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <PWAProvider>
      <App />
    </PWAProvider>
  </I18nProvider>,
);
