import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Celebrations, Toaster } from './components/feedback';
import { PageSpinner } from './components/layouts';
import { ApiError } from './lib/api';
import { adoptNativeDeviceId, computeFingerprint } from './lib/device';
import { router } from './router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API on client errors; retry transient/network failures.
      retry: (count, err) =>
        err instanceof ApiError && err.status >= 400 && err.status < 500 ? false : count < 2,
    },
  },
});

void computeFingerprint();
// Inside the Android app, adopt the GAID as device id before the first API call
// (bounded wait — never delay app start on the bridge).
void Promise.race([adoptNativeDeviceId(), new Promise((r) => setTimeout(r, 400))]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<PageSpinner />}>
        <RouterProvider router={router} />
      </Suspense>
      <Toaster />
      <Celebrations />
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
