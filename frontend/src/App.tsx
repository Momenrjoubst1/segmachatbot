import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ui/core/ErrorBoundary";
import { AuthProvider, useAuthContext } from "@/context/AuthContext";
import { TitleProvider } from "@/context/TitleContext";
import { BrowserRouter } from "react-router-dom";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { SessionWarningBanner } from "@/components/SessionWarningBanner";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { LoginPage } from "@/components/LoginPage";
import { AppSkeleton } from "@/components/ui/AppSkeleton";

const AssistantApp = lazy(() => import("@/features/ai-assistant/AssistantApp").then(m => ({ default: m.AssistantApp })));

function AppContent() {
  const { isAuthenticated, isLoading } = useAuthContext();

  useEffect(() => {
    // Register service worker for offline support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('SW registration failed:', error);
      });
    }
  }, []);

  if (isLoading) {
    return <AppSkeleton />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <div className="relative h-screen h-[100dvh] w-full flex flex-col items-center overflow-hidden bg-background">
      <SessionWarningBanner />
      <ErrorBoundary componentName="AssistantApp">
        <Suspense fallback={<AppSkeleton />}>
          <AssistantApp />
        </Suspense>
      </ErrorBoundary>
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
