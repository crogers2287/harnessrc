import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import './style.css';
import { selectTransport } from '@harnessrc/client-sdk';

const savedTheme = localStorage.getItem('relay-theme') ?? 'system';
document.documentElement.dataset.theme = savedTheme;
// Mobile browsers may resize only the visual viewport when the keyboard opens.
const resizeViewport = () => {
  if (window.visualViewport && window.visualViewport.scale === 1)
    document.documentElement.style.setProperty('--app-height', `${window.visualViewport.height}px`);
};
window.visualViewport?.addEventListener('resize', resizeViewport);
resizeViewport();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});
void selectTransport().then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
if ('serviceWorker' in navigator)
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
