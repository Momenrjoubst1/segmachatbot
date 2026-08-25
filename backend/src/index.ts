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
import { logger, initSentry, log } from "./utils/logger.js";
import { validateConfigurationOrExit } from "./config/config-validator.js";
import { validateToolRegistry } from "./tools/tool-metadata.js";
import { initTools } from "./tools/tool-definitions-aggregator.js";
import { createErrorResponse, logError, AppError } from "./utils/error-handler.js";

initSentry();

import chatRoutes from "./routes/chat.routes.js";
import guestRoutes from "./routes/guest.routes.js";
import feedbackRoutes from "./routes/feedback.routes.js";
import memoryRoutes from "./routes/memory.routes.js";
import artifactsRoutes, { publicArtifactsRouter } from "./routes/artifacts.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import proxyRoutes from "./routes/proxy.routes.js";
import moderationRoutes from "./routes/moderation.routes.js";
import textbookRoutes from "./routes/textbook.routes.js";
import sttRoutes from "./routes/stt.routes.js";
import ttsRoutes from "./routes/tts.routes.js";
import voiceRoutes from "./routes/voice.routes.js";
import toolsRoutes from "./routes/tools.routes.js";
import { studyRoutes } from "./routes/study.routes.js";
import { initializeBM25FromDB } from "./services/rag/bm25-search.js";
import { warmUpReranker } from "./services/rag/document-reranker.js";

// ==========================================
// Startup validation
// ==========================================
function logStartupConfigSummary(): void {
  const providersAvailable: string[] = [];
  if (process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY) providersAvailable.push("Azure");
  if (process.env.GROQ_API_KEY) providersAvailable.push("Groq");
  if (process.env.GITHUB_TOKEN) providersAvailable.push("GitHub");
  if (process.env.OPENROUTER_API_KEY) providersAvailable.push("OpenRouter");
  if (process.env.FIREWORKS_API_KEY) providersAvailable.push("Fireworks");
  if (process.env.BIGMODEL_API_KEY) providersAvailable.push("BigModel");
  if (process.env.GEMINI_API_KEY) providersAvailable.push("Gemini");

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

validateConfigurationOrExit();

// Validate tool registry
const toolValidation = validateToolRegistry();
if (!toolValidation.valid) {
  log.warn('Tool registry validation issues:', { issues: toolValidation.issues });
} else {
  log.info('✅ Tool registry validation passed');
}

// Initialize tools (with per-tool error isolation)
await initTools();

// Pre-warm reranker to avoid cold-start on first request
warmUpReranker().catch((err) => {
  log.warn("Reranker warm-up failed (non-fatal)", { error: err.message });
});

testRedisConnection();
initializeBM25FromDB();
logStartupConfigSummary();

const app = express();
app.set("trust proxy", appConfig.trustProxyHops);

// Helmet sets: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Referrer-Policy, Strict-Transport-Security, X-DNS-Prefetch-Control,
// X-Download-Options, X-Permitted-Cross-Domain-Policies, Cross-Origin-*.
app.use(helmet());
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
    exposedHeaders: ['X-Thread-Id', 'X-Guest-Message-Count', 'X-Guest-Message-Limit', 'X-Guest-Retry-After', 'X-Model-Fallback'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }),
);

app.use(express.json({ limit: appConfig.bodyLimit || "10mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(globalLimiter);

// Sigma AI Chatbot routes only
app.use("/api/chat", authMiddleware, chatRoutes);
app.use("/api/guest", guestRoutes); // No auth — public guest endpoint
app.use("/api/feedback", authMiddleware, feedbackRoutes);
app.use("/api/moderation", authMiddleware, moderationRoutes);
app.use("/api/proxy", authMiddleware, proxyLimiter, proxyRoutes);
app.use("/api/memory", authMiddleware, memoryRoutes);
app.use("/api/artifacts", authMiddleware, artifactsRoutes);
app.use("/api/public/artifacts", publicArtifactsRouter); // No auth — public share links
app.use("/api/analytics", authMiddleware, analyticsRoutes);
app.use("/api/textbooks", authMiddleware, textbookRoutes);
app.use("/api/stt", authMiddleware, sttRoutes);
app.use("/api/tts", authMiddleware, ttsRoutes);
app.use("/api/voice", authMiddleware, voiceRoutes);
app.use("/api/tools", authMiddleware, toolsRoutes);
app.use("/api/study", authMiddleware, studyRoutes);

if (process.env.NODE_ENV === "development") {
  app.post("/api/dev/reprocess/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { supabase } = await import("./config/supabase.config.js");
      const { enqueueTextbookJob } = await import("./services/textbook/textbook-queue.js");

      const { data: textbook } = await supabase
        .from("textbooks")
        .select("id, file_url, file_hash, user_id")
        .eq("id", id)
        .maybeSingle();

      if (!textbook) { res.status(404).json({ error: "Not found" }); return; }

      await supabase
        .from("textbooks")
        .update({ status: "pending", error: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      await supabase.from("textbook_chunks").delete().eq("textbook_id", id);
      await supabase.from("textbook_figures").delete().eq("textbook_id", id);
      await supabase.from("textbook_pages").delete().eq("textbook_id", id);
      await supabase.from("textbook_glossary").delete().eq("textbook_id", id);
      await supabase.from("textbook_questions").delete().eq("textbook_id", id);
      await supabase.from("textbook_sections").delete().eq("textbook_id", id);

      await enqueueTextbookJob({
        textbookId: id,
        fileUrl: textbook.file_url,
        userId: textbook.user_id,
        fileHash: textbook.file_hash || "",
      });

      res.json({ ok: true, textbook_id: id });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/dev/reembed/:id", authMiddleware, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { embedTextbookChunks } = await import("./services/textbook/textbook-embeddings.js");
      const embedded = await embedTextbookChunks(id);
      res.json({ ok: true, textbook_id: id, embedded });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

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
    const bm25 = getBM25Search();
    bm25Stats = bm25.getStats();
  } catch {
    bm25Stats = null;
  }

  const providers: string[] = [];
  if (process.env.AZURE_API_KEY || process.env.AZURE_OPENAI_API_KEY) providers.push("azure");
  if (process.env.BIGMODEL_API_KEY) providers.push("bigmodel");
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
    
    // Log the error using standardized error handler
    logError(error as AppError);
    
    // Create standardized error response
    const errorResponse = createErrorResponse(error as AppError);
    
    res.status(errorResponse.error.statusCode).json(errorResponse);
  },
);

if (appConfig.nodeEnv !== "test") {
  logger.info(`Final Port Config: ${PORT}`);

  const server = app.listen(PORT, appConfig.nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1", () => {
    logger.info(`Sigma AI Backend running on http://localhost:${PORT}`);

    // Voice dictation relay — /ws/stt (Deepgram Nova-3 streaming)
    import("./ws/stt-ws.js").then(({ attachSttWebSocket }) => {
      attachSttWebSocket(server);
      logger.info("STT WebSocket ready");
    }).catch((err) => logger.warn("STT WebSocket attach failed", { error: err.message }));

    // Live Voice TTS relay — /ws/tts-stream (ElevenLabs Flash v2.5 streaming)
    import("./ws/tts-stream-ws.js").then(({ attachTtsStreamWebSocket }) => {
      attachTtsStreamWebSocket(server);
      logger.info("TTS stream WebSocket ready");
    }).catch((err) => logger.warn("TTS stream WebSocket attach failed", { error: err.message }));

    // Start textbook processing worker (non-blocking, only processes when jobs exist)
    import("./services/textbook/textbook-worker.js").then(({ startTextbookWorker }) => {
      startTextbookWorker();
      logger.info("Textbook worker started");
    }).catch((err) => {
      logger.warn("Textbook worker failed to start (non-fatal)", { error: err.message });
    });

    // Start email scheduler worker (polls email_schedules + email_jobs every 60s)
    import("./tools/email/send/email-scheduler-worker.js").then(({ startEmailSchedulerWorker }) => {
      startEmailSchedulerWorker();
      logger.info("Email scheduler worker started");
    }).catch((err) => {
      logger.warn("Email scheduler worker failed to start (non-fatal)", { error: err.message });
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      const { stopTextbookWorker } = await import("./services/textbook/textbook-worker.js");
      await stopTextbookWorker();
    } catch { /* worker may not have started */ }
    try {
      const { stopEmailSchedulerWorker } = await import("./tools/email/send/email-scheduler-worker.js");
      stopEmailSchedulerWorker();
    } catch { /* worker may not have started */ }
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
