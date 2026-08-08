import "./config/dotenv-loader.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";

import { appConfig, isAllowedCorsOrigin } from "./config/app.config.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { globalLimiter, healthLimiter, proxyLimiter } from "./middleware/rate-limiters.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { logger, initSentry } from "./utils/logger.js";

initSentry();

import chatRoutes from "./routes/chat.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import memoryRoutes from "./routes/memory.routes.js";
import artifactsRoutes from "./routes/artifacts.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import proxyRoutes from "./routes/proxy.routes.js";
import moderationRoutes from "./routes/moderation.routes.js";
import { initializeBM25FromDB } from "./services/rag/bm25-search.js";

// ==========================================
// Startup validation
// ==========================================
function validateStartupConfig(): void {
  const missing: string[] = [];

  const supabaseUrl = process.env.SUPABASE_URL || process.env.AUTH_SUPABASE_URL;
  if (!supabaseUrl) missing.push("SUPABASE_URL");

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) missing.push("REDIS_URL (or REDIS_HOST)");
  if (!process.env.ASSISTANT_DEFAULT_MODEL) missing.push("ASSISTANT_DEFAULT_MODEL");

  const hasProvider = !!(
    process.env.AZURE_API_KEY ||
    process.env.AZURE_OPENAI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.GITHUB_TOKEN ||
    process.env.OPENROUTER_API_KEY
  );
  if (!hasProvider) missing.push("At least one AI provider key (AZURE_API_KEY, GROQ_API_KEY, GITHUB_TOKEN, or OPENROUTER_API_KEY)");

  if (missing.length > 0) {
    logger.error("Startup validation failed — missing required environment variables:", { missing });
    process.exit(1);
  }

  const providersAvailable: string[] = [];
  if (process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY) providersAvailable.push("Azure");
  if (process.env.GROQ_API_KEY) providersAvailable.push("Groq");
  if (process.env.GITHUB_TOKEN) providersAvailable.push("GitHub");
  if (process.env.OPENROUTER_API_KEY) providersAvailable.push("OpenRouter");
  if (process.env.FIREWORKS_API_KEY) providersAvailable.push("Fireworks");

  logger.info("Startup configuration summary", {
    model: process.env.ASSISTANT_DEFAULT_MODEL,
    providers: providersAvailable,
    ragEnabled: !!process.env.SUPABASE_URL,
    memoryEnabled: true,
    redisConfigured: !!(process.env.REDIS_URL || process.env.REDIS_HOST),
    multiAgent: process.env.MULTI_AGENT_ENABLED === "true",
  });
}

async function testRedisConnection(): Promise<void> {
  try {
    const { default: redis } = await import("./config/redis/client.js");
    if (typeof redis.ping === "function") {
      await redis.ping();
      logger.info("Redis connection test: OK");
    }
  } catch (err) {
    logger.warn("Redis connection test failed — running in degraded mode without cache", {
      error: (err as Error)?.message,
    });
  }
}

validateStartupConfig();
testRedisConnection();
initializeBM25FromDB();

const app = express();
app.disable('x-powered-by');
app.set("trust proxy", appConfig.trustProxyHops);

// Helmet sets: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Referrer-Policy, Strict-Transport-Security, X-DNS-Prefetch-Control,
// X-Download-Options, X-Permitted-Cross-Domain-Policies, Cross-Origin-*.
// We add a strict Permissions-Policy on top because helmet doesn't set one.
app.use(
  helmet({
    permissionsPolicy: {
      features: {
        geolocation: [],
        microphone: [],
        camera: [],
      },
    },
  }),
);
app.use(requestIdMiddleware);

const PORT = Number(appConfig.port);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    exposedHeaders: ['X-Thread-Id'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }),
);

app.use(express.json({ limit: appConfig.bodyLimit || "10mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(globalLimiter);

// Sigma AI Chatbot routes only
app.use("/api/chat", authMiddleware, chatRoutes);
app.use("/api/feedback", authMiddleware, feedbackRoutes);
app.use("/api/moderation", authMiddleware, moderationRoutes);
app.use("/api/proxy", authMiddleware, proxyLimiter, proxyRoutes);
app.use("/api/memory", authMiddleware, memoryRoutes);
app.use("/api/artifacts", authMiddleware, artifactsRoutes);
app.use("/api/analytics", authMiddleware, analyticsRoutes);

app.get("/api/health", healthLimiter, async (_req: Request, res: Response) => {
  const startMs = Date.now();

  let redisStatus: "ok" | "degraded" | "unavailable" = "unavailable";
  try {
    const { default: redis } = await import("./config/redis/client.js");
    if (typeof redis.ping === "function") {
      await redis.ping();
      redisStatus = "ok";
    }
  } catch {
    redisStatus = "unavailable";
  }

  let bm25Stats: { totalDocs: number; avgDocLen: number; vocabSize: number } | null = null;
  try {
    const { getBM25Search } = await import("./services/rag/bm25-search.js");
    bm25Stats = getBM25Search().getStats();
  } catch {
    bm25Stats = null;
  }

  const providers: string[] = [];
  if (process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY) providers.push("azure");
  if (process.env.GROQ_API_KEY) providers.push("groq");
  if (process.env.GITHUB_TOKEN) providers.push("github");
  if (process.env.OPENROUTER_API_KEY) providers.push("openrouter");
  if (process.env.FIREWORKS_API_KEY) providers.push("fireworks");

  const overallStatus =
    redisStatus === "ok" && providers.length > 0 ? "ok" : "degraded";

  res.status(overallStatus === "ok" ? 200 : 503).json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    latencyMs: Date.now() - startMs,
    services: {
      redis: redisStatus,
      bm25: bm25Stats
        ? { status: "ok", ...bm25Stats }
        : { status: "unavailable" },
      aiProviders: { available: providers, count: providers.length },
    },
  });
});

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err instanceof Error ? err : new Error("Unknown error");
    logger.error("Unhandled error", {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  },
);

if (appConfig.nodeEnv !== "test") {
  logger.info(`Final Port Config: ${PORT}`);

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Sigma AI Backend running on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      const { cleanupAllAgentsOnShutdown } = await import("./services/agent.service.js");
      await cleanupAllAgentsOnShutdown();
    } catch (err) {
      logger.error("Error cleaning up agents during shutdown:", err instanceof Error ? err : new Error(String(err)));
    }
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.error("Fatal uncaughtException", {
      message: err.message,
      stack: err.stack,
    });
    setTimeout(() => process.exit(1), 1000);
  });

  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error("Unhandled promise rejection", {
      message: error.message,
      stack: error.stack,
    });
  });
}

export default app;
