import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";
import { AuthProvider, useAuthContext } from "@/context/AuthContext";
import { TitleProvider } from "@/context/TitleContext";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { SessionWarningBanner } from "@/components/SessionWarningBanner";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { NotFound } from "@/components/ui/ghost-404-page";

import { LoginPage } from "@/components/LoginPage";

/**
 * Lazy-load with automatic retry for chunk load failures.
 * This handles network hiccups and stale chunks after deployments.
 */
function lazyWithRetry<T extends React.ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
  retries = 2,
  delay = 1000,
) {
  return lazy(() =>
    importFn().catch((err: unknown) => {
      // Only retry on chunk load errors (network or missing chunk)
      const isChunkError =
        err instanceof Error &&
        (/Failed to fetch dynamically imported module/.test(err.message) ||
          /Importing a module script failed/.test(err.message) ||
          /Loading chunk \d+ failed/.test(err.message) ||
          (err as { code?: string }).code === "ERR_CHUNK_LOAD_TIMEOUT");

      if (isChunkError && retries > 0) {
        return new Promise<{ default: T }>((resolve) =>
          setTimeout(() => resolve(lazyWithRetry(importFn, retries - 1, delay * 2) as unknown as { default: T }), delay),
        ).then((m) => m);
      }

      throw err;
    }),
  );
}

const AssistantApp = lazyWithRetry(() =>
  import("@/features/ai-assistant/AssistantApp").then((m) => ({ default: m.AssistantApp })),
);

function RouteFallback() {
  return (
    <div className="flex h-screen h-[100dvh] w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { isAuthLoading } = useAuthContext();

  useEffect(() => {
    // Register service worker for offline support — production builds only.
    // main.tsx unregisters stale SWs in dev; registering here unconditionally
    // would immediately re-register and defeat that cleanup (breaking HMR).
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('SW registration failed:', error);
      });
    }
  }, []);

  if (isAuthLoading) {
    // Session restore gate — a spinner instead of null so slow networks
    // show intent rather than a blank white screen.
    return (
      <div className="flex h-screen h-[100dvh] w-full items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="relative h-screen h-[100dvh] w-full flex flex-col items-center overflow-hidden bg-background">
      <SessionWarningBanner />
      <Routes>
        <Route
          path="/login"
          element={
            <ErrorBoundary componentName="LoginPage">
              <LoginPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/"
          element={
            <ErrorBoundary componentName="AssistantApp">
              <Suspense fallback={<RouteFallback />}>
                <AssistantApp />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="*"
          element={
            <ErrorBoundary componentName="NotFound">
              <NotFound />
            </ErrorBoundary>
          }
        />
      </Routes>
      <OfflineBanner />
      <SessionExpiredModal />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <TitleProvider>
            <AppContent />
          </TitleProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
