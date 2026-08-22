import axios from "axios";
import crypto from "crypto";
import redis from "../../../config/redis/client.js";
import { circuitBreakerRegistry } from "../../../utils/circuit-breaker.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface WebSearchProvider {
  name: string;
  search(query: string, count?: number): Promise<WebSearchResult[]>;
  priority?: number; // Lower number = higher priority
}

const CACHE_TTL_SECONDS = Math.max(0, Number(process.env.WEB_SEARCH_CACHE_TTL_SECONDS || "3600"));
const SEARCH_TIMEOUT_MS = Number(process.env.WEB_SEARCH_TIMEOUT_MS || "8000");

const BraveSearchProvider: WebSearchProvider = {
  name: "brave",
  priority: 1, // Highest priority
  search: async (query, count = 5) => {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not configured");
    
    const breaker = circuitBreakerRegistry.get('brave-search', {
      failureThreshold: 3,
      resetTimeout: 30000, // 30 seconds
      monitoringPeriod: 60000,
    });
    
    return breaker.execute(async () => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
      const { data } = await axios.get<{ web?: { results?: Array<{ title?: string; url?: string; description?: string; snippet?: string }> } }>(url, {
        headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
        timeout: SEARCH_TIMEOUT_MS,
      });
      return (data.web?.results || []).slice(0, count).map((r) => ({
        title: r.title || "No title",
        url: r.url || "",
        snippet: r.description || r.snippet || "No description",
        source: "brave",
      }));
    });
  },
};

const GoogleCSEProvider: WebSearchProvider = {
  name: "google_cse",
  priority: 2,
  search: async (query, count = 5) => {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) throw new Error("GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX not configured");
    
    const breaker = circuitBreakerRegistry.get('google-cse', {
      failureThreshold: 3,
      resetTimeout: 30000,
      monitoringPeriod: 60000,
    });
    
    return breaker.execute(async () => {
      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${count}`;
      const { data } = await axios.get<{ items?: Array<{ title?: string; link?: string; snippet?: string }> }>(url, { timeout: SEARCH_TIMEOUT_MS });
      return (data.items || []).slice(0, count).map((r) => ({
        title: r.title || "No title",
        url: r.link || "",
        snippet: r.snippet || "No description",
        source: "google_cse",
      }));
    });
  },
};

const TavilyProvider: WebSearchProvider = {
  name: "tavily",
  priority: 3, // Lowest priority
  search: async (query, count = 5) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY not configured");
    
    const breaker = circuitBreakerRegistry.get('tavily', {
      failureThreshold: 3,
      resetTimeout: 30000,
      monitoringPeriod: 60000,
    });
    
    return breaker.execute(async () => {
      const { data } = await axios.post<{ results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }> }>(
        "https://api.tavily.com/search",
        { api_key: apiKey, query, max_results: count, search_depth: "basic" },
        { timeout: SEARCH_TIMEOUT_MS }
      );
      return (data.results || []).slice(0, count).map((r) => ({
        title: r.title || "No title",
        url: r.url || "",
        snippet: r.content || r.snippet || "No description",
        source: "tavily",
      }));
    });
  },
};

function getProviders(): WebSearchProvider[] {
  const providers: WebSearchProvider[] = [];
  if (process.env.BRAVE_SEARCH_API_KEY) providers.push(BraveSearchProvider);
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) providers.push(GoogleCSEProvider);
  if (process.env.TAVILY_API_KEY) providers.push(TavilyProvider);
  
  // Sort by priority (lower number = higher priority)
  return providers.sort((a, b) => (a.priority || 999) - (b.priority || 999));
}

export async function searchWeb(query: string, count: number = 5): Promise<WebSearchResult[]> {
  const cacheKey = `web_search:${crypto.createHash("md5").update(`${query}:${count}`).digest("hex")}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached) as WebSearchResult[]; } catch { /* ignore */ }
    }
  } catch { /* redis unavailable */ }

  const providers = getProviders();
  if (providers.length === 0) return [];

  // Try providers in priority order with fallback
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      const results = await provider.search(query, count);
      if (results.length > 0) {
        try { await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(results)); } catch { /* ignore */ }
        return results;
      }
    } catch (error) {
      lastError = error as Error;
      console.warn(`Web search provider ${provider.name} failed, trying next provider`, { error: lastError.message });
    }
  }

  // All providers failed
  if (lastError) {
    console.error('All web search providers failed', { error: lastError.message });
  }
  return [];
}

export function isWebSearchAvailable(): boolean {
  return getProviders().length > 0;
}
