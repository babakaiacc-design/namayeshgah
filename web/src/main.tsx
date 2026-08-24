import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App';
import { restoreSession } from './lib/auth';
import { applyTheme, readTheme } from './lib/theme';
import './styles/app.css';

// Attaches a stored token before React mounts, so the first request already
// carries it rather than firing anonymously and being retried.
restoreSession();

// Applied before React mounts, otherwise the default palette paints for a frame
// and then flashes to the chosen one.
applyTheme(readTheme());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The calendar changes at most a couple of times a day, and the service
      // worker already serves a cached copy first. Refetching on every focus
      // would only add load and spin the free instance up for nothing.
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
