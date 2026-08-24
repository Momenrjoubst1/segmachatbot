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
import { GuestModeProvider } from "@/context/GuestModeContext";
import { ChatHistoryProvider } from "@/hooks/useChatHistory";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarView } from "@/features/ai-assistant/shadcn/components/Sidebar/SidebarView";

/**
 * Claude-style artifacts shell: the sidebar stays on the left, the library
 * page renders in the content area on the right.
 */
function ArtifactsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestModeProvider>
      <ChatHistoryProvider>
        <TooltipProvider>
          <div className="flex h-screen h-[100dvh] w-full overflow-hidden bg-[#FDFBF7] text-foreground">
            <div className="hidden shrink-0 md:block">
              <SidebarView
                courses={[]}
                activeCourse={null}
                onActiveCourseChange={() => {}}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
          </div>
        </TooltipProvider>
      </ChatHistoryProvider>
    </GuestModeProvider>
  );
}

const AssistantApp = lazy(() => import("@/features/ai-assistant/AssistantApp").then(m => ({ default: m.AssistantApp })));
const ArtifactPage = lazy(() => import("@/features/artifacts/ArtifactPage").then(m => ({ default: m.ArtifactPage })));
const ArtifactLibraryPage = lazy(() => import("@/features/artifacts/ArtifactLibraryPage").then(m => ({ default: m.ArtifactLibraryPage })));

function RouteFallback() {
  return (
    <div className="flex h-screen h-[100dvh] w-full items-center justify-center bg-background">
      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
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
          path="/artifacts"
          element={
            <ErrorBoundary componentName="ArtifactLibraryPage">
              <Suspense fallback={<RouteFallback />}>
                <ArtifactsLayout>
                  <ArtifactLibraryPage />
                </ArtifactsLayout>
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/artifacts/:id"
          element={
            <ErrorBoundary componentName="ArtifactPage">
              <Suspense fallback={<RouteFallback />}>
                <ArtifactPage />
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
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <TitleProvider>
            <AppContent />
          </TitleProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
