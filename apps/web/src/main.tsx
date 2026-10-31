import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import '@/styles/index.css';
import '@/lib/i18n';
import { cachedTheme, applyTheme } from '@/lib/theme';
import { applyStoredTextSize } from '@/layout/useLargeText';
import { router } from '@/app/router';

// Paint the last-used theme before React renders, so reloads don't flash default colours.
const cached = cachedTheme();
applyTheme(cached.settings, cached.mode);
applyStoredTextSize();

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 30_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
