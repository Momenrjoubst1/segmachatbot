import axios from "axios";
import crypto from "crypto";
import redis from "../../../config/redis/client.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface WebSearchProvider {
  name: string;
  search(query: string, count?: number): Promise<WebSearchResult[]>;
}

const CACHE_TTL_SECONDS = Math.max(0, Number(process.env.WEB_SEARCH_CACHE_TTL_SECONDS || "3600"));

const BraveSearchProvider: WebSearchProvider = {
  name: "brave",
  search: async (query, count = 5) => {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not configured");
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const { data }: any = await axios.get(url, {
      headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
      timeout: 8000,
    });
    return (data.web?.results || []).slice(0, count).map((r: any) => ({
      title: r.title || "No title",
      url: r.url || "",
      snippet: r.description || r.snippet || "No description",
      source: "brave",
    }));
  },
};

const GoogleCSEProvider: WebSearchProvider = {
  name: "google_cse",
  search: async (query, count = 5) => {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) throw new Error("GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX not configured");
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${count}`;
    const { data }: any = await axios.get(url, { timeout: 8000 });
    return (data.items || []).slice(0, count).map((r: any) => ({
      title: r.title || "No title",
      url: r.link || "",
      snippet: r.snippet || "No description",
      source: "google_cse",
    }));
  },
};

const TavilyProvider: WebSearchProvider = {
  name: "tavily",
  search: async (query, count = 5) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error("TAVILY_API_KEY not configured");
    const { data }: any = await axios.post(
      "https://api.tavily.com/search",
      { api_key: apiKey, query, max_results: count, search_depth: "basic" },
      { timeout: 8000 }
    );
    return (data.results || []).slice(0, count).map((r: any) => ({
      title: r.title || "No title",
      url: r.url || "",
      snippet: r.content || r.snippet || "No description",
      source: "tavily",
    }));
  },
};

function getProviders(): WebSearchProvider[] {
  const providers: WebSearchProvider[] = [];
  if (process.env.BRAVE_SEARCH_API_KEY) providers.push(BraveSearchProvider);
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) providers.push(GoogleCSEProvider);
  if (process.env.TAVILY_API_KEY) providers.push(TavilyProvider);
  return providers;
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

  const results = await providers[0].search(query, count);
  if (results.length > 0) {
    try { await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(results)); } catch { /* ignore */ }
  }
  return results;
}

export function isWebSearchAvailable(): boolean {
  return getProviders().length > 0;
}
