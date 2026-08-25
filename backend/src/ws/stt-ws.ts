/**
 * STT WebSocket endpoint — /ws/stt?token=<supabase-jwt>
 *
 * Attached to the main HTTP server via `attachSttWebSocket(server)`.
 *
 * Protocol (after successful upgrade):
 *   → first client frame MUST be JSON { type:"config", sampleRate:number }
 *   → subsequent frames: binary PCM16LE mono audio @ sampleRate
 *   → JSON { type:"stop" } ends gracefully
 *   ← { type:"ready" } | { type:"partial"|"final", text }
 *
 * Auth mirrors auth.middleware.ts essentials: JWT → supabase.auth.getUser,
 * auth-user banned_until, plus active rows in banned_users.
 * Audio is piped straight to Deepgram — never stored. Session limits live
 * in services/stt/deepgram-relay.ts (duration / concurrency / daily minutes).
 */

import type { Server as HttpServer } from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { createLogger } from "../utils/logger.js";
import { supabase } from "../config/supabase.config.js";
import redis from "../config/redis/client.js";
import { SttRelaySession } from "../services/stt/deepgram-relay.js";

const log = createLogger("stt-ws");

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const activeSessions = new Set<string>();

export function isSttEnabled(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

/** Shared auth contract for STT + any future streaming relays. */
export async function verifyToken(
  token: string,
  allowAnonDev: boolean,
  socket: Duplex,
): Promise<{ userId: string } | null> {
  // Dev escape hatch: STT_ALLOW_ANON_DEV=true lets localhost clients open a
  // session without a JWT so the full relay chain is testable headlessly.
  if (!token && allowAnonDev) {
    const ip = (socket as import("net").Socket).remoteAddress || "local";
    return { userId: `anon:${ip}` };
  }
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    const userId = data.user.id;

    const bannedUntilRaw =
      (data.user as unknown as { banned_until?: string | null }).banned_until ?? null;
    if (bannedUntilRaw && new Date(bannedUntilRaw).getTime() > Date.now()) return null;

    const { data: banRows } = await supabase
      .from('banned_users')
      .select('expires_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(10);
    if ((banRows ?? []).some((row) => !row.expires_at || new Date(row.expires_at as string) > new Date())) {
      return null;
    }

    return { userId };
  } catch {
    return null;
  }
}

function cleanupActive(userId: string): void {
  activeSessions.delete(userId);
  void redis.del(`stt:active:${userId}`).catch(() => {});
}

function handleSttUpgrade(req: import("http").IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const allowAnonDev =
    process.env.STT_ALLOW_ANON_DEV === "true" &&
    /localhost|127\.0\.0\.1/.test(req.headers.host || "");
  const token = url.searchParams.get("token") || "";

  wss.handleUpgrade(req, socket, head, async (clientWs) => {
    const auth = await verifyToken(token, allowAnonDev, socket);

    if (!auth) { clientWs.close(4401, "unauthorized"); return; }

    if (!isSttEnabled()) { clientWs.close(4003, "stt_disabled"); return; }

    if (activeSessions.has(auth.userId)) {
      clientWs.close(4029, "already_streaming"); return;
    }

    const gate = await SttRelaySession.canOpenSession(auth.userId);
    if (!gate.ok) { clientWs.close(gate.code ?? 4029, gate.reason ?? "limit"); return; }

    activeSessions.add(auth.userId);
    void redis.set(`stt:active:${auth.userId}`, "1", "EX", 300).catch(() => {});
    log.info("STT session opened", { userId: auth.userId });

    let configSeen = false;
    let session: SttRelaySession | null = null;
    // The session is created LAZILY on the first client frame so the config
    // frame's sample rate (the mic's TRUE post-decimation rate) can label the
    // Deepgram stream correctly — a hardcoded 16k mislabels narrowband mics
    // (Bluetooth HFP) and transcribes to nothing.
    let negotiatedRate = 16000;
    const ensureSession = (): SttRelaySession =>
      session ??= new SttRelaySession(auth.userId, clientWs, negotiatedRate, {
        onClose: () => cleanupActive(auth.userId),
      });

    clientWs.on("message", (data: unknown, isBinary: boolean) => {
      if (!configSeen && !isBinary) {
        try {
          const cfg = JSON.parse(String(data)) as { type?: string; sampleRate?: number };
          if (cfg.type === "config") {
            configSeen = true;
            if (
              typeof cfg.sampleRate === "number" &&
              cfg.sampleRate >= 4000 && cfg.sampleRate <= 96_000
            ) {
              negotiatedRate = Math.round(cfg.sampleRate);
            }
            ensureSession();
            return;
          }
        } catch { /* treat as audio anyway */ }
      }
      ensureSession().handleClientMessage(data, isBinary);
    });

    clientWs.on("close", () => {
      cleanupActive(auth.userId);
      session?.close(1000, "client_closed");
    });

    clientWs.on("error", () => session?.close(1011, "client_error"));

    clientWs.send(JSON.stringify({ type: "ready", provider: "deepgram", model: "nova-3" }));
  });
}

export function attachSttWebSocket(server: HttpServer): void {
  server.on("upgrade", (req: import("http").IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = (() => {
      try { return new URL(req.url || "/", "http://localhost").pathname; }
      catch { return ""; }
    })();
    if (pathname === "/ws/stt") handleSttUpgrade(req, socket, head);
    // other upgrade paths ignored (no other WS servers on this process)
  });
  if (!isSttEnabled()) {
    log.warn("STT endpoint attached but DEEPGRAM_API_KEY missing — sessions will close with stt_disabled");
  }
  log.info("STT WebSocket attached at /ws/stt");
}