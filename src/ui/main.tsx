import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyTheme, loadSettings } from './settings';
import './styles.css';

applyTheme(loadSettings().theme);

// ブラウザの容量が足りなくなっても、セーブを勝手に消さないように頼む（認められないこともある）
void navigator.storage?.persist?.().catch(() => false);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
}
