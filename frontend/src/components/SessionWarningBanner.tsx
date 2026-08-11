import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/cn";
import { AlertTriangle, LogIn, RefreshCcw } from "lucide-react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const WARNING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes before expiry
const REAPPEAR_DELAY_MS = 5 * 60 * 1000; // reappear after 5 min if not addressed

export function SessionWarningBanner() {
  const [status, setStatus] = useState<"none" | "expiring" | "expired">("none");
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.expires_at) {
        setStatus("none");
        return;
      }

      const expiresAtMs = session.expires_at * 1000;
      const now = Date.now();
      const remaining = expiresAtMs - now;

      if (remaining <= 0) {
        setStatus("expired");
        setMinutesLeft(0);
      } else if (remaining < WARNING_THRESHOLD_MS) {
        setStatus("expiring");
        setMinutesLeft(Math.ceil(remaining / 60_000));
      } else {
        setStatus("none");
      }
    } catch {
      // ignore check failures
    }
  }, []);

  useEffect(() => {
    checkSession();
    const id = setInterval(checkSession, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkSession]);

  // Reappear after dismiss delay
  useEffect(() => {
    if (!dismissed || status === "none") return;
    const id = setTimeout(() => setDismissed(false), REAPPEAR_DELAY_MS);
    return () => clearTimeout(id);
  }, [dismissed, status]);

  // Reset dismiss when status changes to expired (new hard failure)
  useEffect(() => {
    if (status === "expired") setDismissed(false);
  }, [status]);

  const handleRefresh = async () => {
    const { error } = await supabase.auth.refreshSession();
    if (!error) {
      await checkSession();
    }
  };

  const handleLogin = () => {
    window.location.href = "/login";
  };

  if (status === "none" || dismissed) return null;

  return (
    <div
      className={cn(
        "relative z-[100] flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium transition-all shrink-0",
        status === "expired"
          ? "bg-red-600 text-white"
          : "bg-amber-500/90 text-white"
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {status === "expired" ? (
        <>
          <span>Your session has expired.</span>
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            <LogIn className="h-3 w-3" />
            Log in again
          </button>
        </>
      ) : (
        <>
          <span>
            Your session expires in {minutesLeft} minute{minutesLeft !== 1 ? "s" : ""}.
          </span>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2.5 py-1 text-xs font-semibold hover:bg-white/30 transition-colors"
          >
            <RefreshCcw className="h-3 w-3" />
            Refresh session
          </button>
        </>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20 transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}
