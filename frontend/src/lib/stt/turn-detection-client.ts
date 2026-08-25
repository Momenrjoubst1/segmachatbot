/**
 * Client for the backend semantic turn-endpointing endpoint.
 *
 * Asked DURING the silence window (~300ms of quiet) so a semantically
 * complete sentence can hand the turn over EARLY while a mid-clause pause
 * keeps listening. Never blocks the audio path: callers get a promise and
 * the RMS loop keeps reading whatever verdict is current.
 */

import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";

export interface TurnVerdict {
  complete: boolean;
  probability?: number;
  source: "onnx" | "heuristic";
}

/** Generous ceiling: a late verdict is worthless, the timers decide alone. */
const REQUEST_TIMEOUT_MS = 900;

export async function judgeTurnComplete(text: string): Promise<TurnVerdict> {
  const res = await authFetch(BACKEND_URL + "/api/voice/turn/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`turn_detect_failed_${res.status}`);
  return (await res.json()) as TurnVerdict;
}
