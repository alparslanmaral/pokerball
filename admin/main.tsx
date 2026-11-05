import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import { createRoot } from 'react-dom/client';
import '../src/ui/styles.css';
import { Admin } from './Admin';
import './admin.css';

createRoot(document.getElementById('root')!).render(<Admin />);
