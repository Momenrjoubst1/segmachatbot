import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SignupPage } from "@/components/ui/sign-up-page";

import type { Location as RouterLocation } from "react-router-dom";

interface LocationState {
  from?: string;
}

const FROM_KEY = "login_redirect_from";

/**
 * Reads the post-login redirect target. location.state survives in-app
 * navigation but is lost on refresh, so it is mirrored to sessionStorage —
 * which also survives refresh — and preferred when present.
 */
function readFrom(location: RouterLocation): string {
  const fromState = (location.state as LocationState | null)?.from;
  if (fromState) {
    try {
      sessionStorage.setItem(FROM_KEY, fromState);
    } catch {
      // sessionStorage unavailable — state-only fallback below
    }
    return fromState;
  }
  try {
    const saved = sessionStorage.getItem(FROM_KEY);
    if (saved) return saved;
  } catch {
    // ignore
  }
  return "/";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Resolve once — later re-renders (form state etc.) must not fall back to "/"
  // just because the storage mirror was already consumed.
  const [from] = useState(() => readFrom(location));

  useEffect(() => {
    // Clear the saved target once consumed so a later /login visit starts fresh.
    try {
      sessionStorage.removeItem(FROM_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <SignupPage
      initialMode="signin"
      onSuccess={() => {
        navigate(from, { replace: true });
      }}
    />
  );
}
