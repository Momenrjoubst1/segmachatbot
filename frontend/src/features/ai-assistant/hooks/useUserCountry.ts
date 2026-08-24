import { useEffect, useState } from "react";

/**
 * Resolves the visitor's country via IP geolocation — used ONLY to decide
 * which phrase set to display: visitors in Jordan get the Jordanian-dialect
 * greetings and suggestion pills, everyone else gets the English defaults.
 *
 * This deliberately does NOT touch the app's UI language or layout
 * direction; those are hard-locked to English/LTR in `@/i18n/i18next`.
 */

const COUNTRY_CACHE_KEY = "sigma_country";
const COUNTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GEO_LOOKUP_URL = "https://get.geojs.io/v1/ip/country.json";
const GEO_TIMEOUT_MS = 1500;

/** How long phrase components wait for the lookup before using the default set. */
export const COUNTRY_RESOLVE_GRACE_MS = 1200;

interface CountryCache {
  code: string;
  fetchedAt: number;
}

function readCache(): string | null {
  try {
    const raw = localStorage.getItem(COUNTRY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CountryCache;
    if (!parsed?.code || typeof parsed.fetchedAt !== "number") return null;
    if (Date.now() - parsed.fetchedAt > COUNTRY_TTL_MS) return null;
    return parsed.code.toUpperCase();
  } catch {
    return null;
  }
}

function writeCache(code: string) {
  try {
    localStorage.setItem(
      COUNTRY_CACHE_KEY,
      JSON.stringify({ code, fetchedAt: Date.now() })
    );
  } catch {
    // Storage unavailable — lookup just runs again next session
  }
}

async function fetchCountryCode(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);
    const res = await fetch(GEO_LOOKUP_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: unknown };
    return typeof data.country === "string" ? data.country.toUpperCase() : null;
  } catch {
    return null;
  }
}

let inflight: Promise<string | null> | null = null;

function resolveCountry(): Promise<string | null> {
  const cached = readCache();
  if (cached) return Promise.resolve(cached);
  // No external network calls in tests — stay unresolved so callers fall back.
  if (import.meta.env?.MODE === "test") return Promise.resolve(null);

  inflight ??= fetchCountryCode()
    .then((code) => {
      if (code) writeCache(code);
      return code;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * `true`  — visitor is in Jordan → Jordanian-dialect phrase set
 * `false` — anywhere else → default (English) phrase set
 * `null`  — not resolved yet (first visit, lookup in flight)
 *
 * On lookup failure this stays `null`; callers apply their own grace
 * timeout and fall back to the default set.
 */
export function useIsInJordan(): boolean | null {
  const [inJordan, setInJordan] = useState<boolean | null>(() => {
    const cached = readCache();
    return cached ? cached === "JO" : null;
  });

  useEffect(() => {
    if (inJordan !== null) return;
    let alive = true;
    resolveCountry().then((code) => {
      if (alive && code !== null) setInJordan(code === "JO");
    });
    return () => {
      alive = false;
    };
  }, [inJordan]);

  return inJordan;
}
