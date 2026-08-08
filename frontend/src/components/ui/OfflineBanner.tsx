import { useState, useEffect } from 'react';
import { WifiOff, RefreshCcw } from 'lucide-react';
import { cn } from '@/lib/cn';

interface OfflineBannerProps {
  className?: string;
}

export function OfflineBanner({ className }: OfflineBannerProps) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      // Show "back online" briefly
      setShowBanner(true);
      setTimeout(() => setShowBanner(false), 3000);
    };

    const handleOffline = () => {
      setIsOffline(true);
      setShowBanner(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check initial state
    if (!navigator.onLine) {
      setShowBanner(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!showBanner && !isOffline) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300",
        showBanner ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-full shadow-lg border",
          isOffline
            ? "bg-orange-500/10 border-orange-500/20 text-orange-500"
            : "bg-green-500/10 border-green-500/20 text-green-500"
        )}
      >
        {isOffline ? (
          <>
            <WifiOff className="w-4 h-4" />
            <span className="text-sm font-medium">You're offline</span>
          </>
        ) : (
          <>
            <RefreshCcw className="w-4 h-4" />
            <span className="text-sm font-medium">Back online</span>
          </>
        )}
      </div>
    </div>
  );
}
