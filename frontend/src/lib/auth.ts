import { supabase } from "./supabaseClient";

let refreshPromise: Promise<string | null> | null = null;

export async function getFreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  
  refreshPromise = (async () => {
    try {
      let { data: { session } } = await supabase.auth.getSession();
      
      if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60_000) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error) {
          session = data.session;
        }
      }
      
      return session?.access_token ?? null;
    } finally {
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

const MAX_AUTH_RETRIES = 1;
const RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getFreshToken();
  const headers = new Headers(init.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res = await fetch(input, { ...init, headers });

  for (let attempt = 0; attempt < MAX_AUTH_RETRIES && res.status === 401; attempt++) {
    const previousToken = token;
    await delay(RETRY_DELAY_MS);

    let freshToken: string | null = null;
    try {
      freshToken = await getFreshToken();
    } catch (refreshErr) {
      // Refresh itself failed — session is truly expired
      throw new Error("SESSION_EXPIRED: Authentication session has expired. Please sign in again.");
    }
    
    if (!freshToken || freshToken === previousToken) {
      throw new Error("SESSION_EXPIRED: Could not refresh authentication token. Please sign in again.");
    }

    headers.set("Authorization", `Bearer ${freshToken}`);
    res = await fetch(input, { ...init, headers });
  }

  return res;
}

export async function getAssistantAuthHeaders(init?: HeadersInit) {
  const headers = new Headers(init);
  const token = await getFreshToken();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}
