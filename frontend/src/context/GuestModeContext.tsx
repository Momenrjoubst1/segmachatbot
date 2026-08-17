import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useAuthContext } from "@/context/AuthContext";

export const GUEST_MESSAGE_LIMIT = 4;

interface GuestQuota {
  count: number;
  limit: number;
  retryAfterSeconds?: number;
}

interface GuestModeContextValue {
  isGuestMode: boolean;
  guestMessageCount: number;
  guestMessageLimit: number;
  retryAfterSeconds: number | null;
  limitReached: boolean;
  setGuestQuota: (quota: GuestQuota) => void;
  refreshGuestStatus: () => Promise<void>;
}

const GuestModeContext = createContext<GuestModeContextValue | null>(null);

export function useGuestMode(): GuestModeContextValue {
  const ctx = useContext(GuestModeContext);
  if (!ctx) throw new Error("useGuestMode must be used within GuestModeProvider");
  return ctx;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

export function GuestModeProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthContext();
  const [guestMessageCount, setGuestMessageCount] = useState(0);
  const [guestMessageLimit, setGuestMessageLimit] = useState(GUEST_MESSAGE_LIMIT);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const limitReached = guestMessageCount >= guestMessageLimit;

  const setGuestQuota = useCallback((quota: GuestQuota) => {
    setGuestMessageCount(quota.count);
    if (quota.limit > 0) {
      setGuestMessageLimit(quota.limit);
    }
    if (quota.retryAfterSeconds !== undefined) {
      setRetryAfterSeconds(quota.retryAfterSeconds);
    }
  }, []);

  const refreshGuestStatus = useCallback(async () => {
    if (isAuthenticated) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/guest/status`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setGuestQuota({
          count: data.count,
          limit: data.limit,
          retryAfterSeconds: data.retryAfterSeconds,
        });
      }
    } catch (err) {
      console.error("[GuestMode] Failed to fetch guest status:", err);
    }
  }, [isAuthenticated, setGuestQuota]);

  // Fetch guest status on mount and when entering guest mode
  useEffect(() => {
    if (!isAuthenticated) {
      refreshGuestStatus();
    } else {
      // Reset guest state when user logs in
      setGuestMessageCount(0);
      setGuestMessageLimit(GUEST_MESSAGE_LIMIT);
      setRetryAfterSeconds(null);
    }
  }, [isAuthenticated, refreshGuestStatus]);

  return (
    <GuestModeContext.Provider
      value={{
        isGuestMode: !isAuthenticated,
        guestMessageCount,
        guestMessageLimit,
        retryAfterSeconds,
        limitReached,
        setGuestQuota,
        refreshGuestStatus,
      }}
    >
      {children}
    </GuestModeContext.Provider>
  );
}
