import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/pwa';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(<App />);
registerServiceWorker();
