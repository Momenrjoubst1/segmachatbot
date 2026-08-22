import { supabase } from '@/lib/supabaseClient';

const FALLBACK_EMAILS = new Set(
  import.meta.env.VITE_VERIFIED_EMAILS?.split(',').filter(Boolean) ?? []
);
const VERIFIED_CACHE = new Map<string, boolean>();
const LS_KEY = 'sk_verified_ids_v2';

function initFromStorage() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const entries = JSON.parse(raw) as string[];
            if (Array.isArray(entries)) {
                entries.forEach(id => VERIFIED_CACHE.set(id, true));
            }
        }
    } catch { }
}

initFromStorage();

function persistCache() {
    try {
        const ids = [...VERIFIED_CACHE.entries()]
            .filter(([, v]) => v)
            .map(([id]) => id);
        localStorage.setItem(LS_KEY, JSON.stringify(ids));
    } catch { }
}

async function fetchAndCacheVerification(userId: string): Promise<boolean> {
    if (VERIFIED_CACHE.has(userId)) return VERIFIED_CACHE.get(userId)!;

    try {
        const { data } = await supabase
            .from('users')
            .select('is_verified')
            .eq('id', userId)
            .maybeSingle();

        const verified = data?.is_verified === true;
        VERIFIED_CACHE.set(userId, verified);
        if (verified) persistCache();
        return verified;
    } catch {
        return false;
    }
}

export async function registerVerifiedUserId(
    email: string | null | undefined,
    userId: string | null | undefined,
) {
    if (!email || !userId) return;

    const verified = await fetchAndCacheVerification(userId);

    if (FALLBACK_EMAILS.has(email) && verified) {
        VERIFIED_CACHE.set(email, true);
        persistCache();
    }
}
