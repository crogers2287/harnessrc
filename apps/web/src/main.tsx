import { prepareMobileHistory } from './navigation.ts';
import { trackViewport } from './viewport.ts';
import './install.ts';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import '@openuidev/react-ui/defaults.css';
import '@openuidev/react-ui/styles/button.css';
import '@openuidev/react-ui/styles/iconButton.css';
import '@openuidev/react-ui/styles/textArea.css';
import './style.css';
import { selectTransport } from '@harnessrc/client-sdk';

const savedTheme = localStorage.getItem('relay-theme') ?? 'system';
document.documentElement.dataset.theme = savedTheme;
trackViewport();
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});
prepareMobileHistory();
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
