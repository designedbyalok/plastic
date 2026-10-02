import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './app/app.css';
import { useEditor } from './editor/store.ts';

// Dev-only handle for debugging from the console: __plastic.getState()
if (import.meta.env.DEV) Object.assign(window, { __plastic: useEditor });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
