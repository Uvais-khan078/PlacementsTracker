import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppCrashBoundary } from './features/system/SystemScreens';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppCrashBoundary><App /></AppCrashBoundary>
  </StrictMode>,
);
