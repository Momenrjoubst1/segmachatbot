import { useCallback, useEffect, useRef, useState } from "react";
import {
  DictationController,
  DictationError,
  fetchSttStatus,
  type DictationState,
} from "@/lib/stt/deepgram-dictation";

export interface UseDictationOptions {
  /** Called on every interim/final change with the FULL live transcript. */
  onTranscript?: (fullText: string) => void;
  onFinalSegment?: (segment: string) => void;
}

export type DictationStatus =
  | "unsupported"
  | "disabled"
  | "ready"
  | "starting"
  | "recording"
  | "stopping";

export function useDictation(options: UseDictationOptions = {}) {
  const [status, setStatus] = useState<DictationStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<DictationController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Accumulated transcript refs so every emission carries the FULL text
  // (finals + rolling interim) — consumers just render it.
  const finalsRef = useRef<string[]>([]);
  const interimRef = useRef("");

  const emitCumulative = useCallback(() => {
    const finals = finalsRef.current.join(" ").trim();
    const full = interimRef.current
      ? [finals, interimRef.current].filter(Boolean).join(" ")
      : finals;
    optionsRef.current.onTranscript?.(full);
  }, []);

  const makeController = useCallback(() => {
    return new DictationController({
      onStateChange: (s: DictationState) => {
        if (s === "recording") setStatus("recording");
        else if (s === "starting") setStatus("starting");
        else if (s === "stopping") setStatus("stopping");
        else if (s === "idle") setStatus("ready");
        else if (s === "error") setStatus("ready");
      },
      onInterim: (t) => {
        interimRef.current = t;
        emitCumulative();
      },
      onFinalSegment: (seg) => {
        finalsRef.current.push(seg);
        interimRef.current = "";
        optionsRef.current.onFinalSegment?.(seg);
        emitCumulative();
      },
    });
  }, [emitCumulative]);

  const resetAccumulator = useCallback(() => {
    finalsRef.current = [];
    interimRef.current = "";
  }, []);

  // Capability probe once: hide mic when backend STT is disabled
  useEffect(() => {
    let cancelled = false;
    fetchSttStatus().then(({ enabled }) => {
      if (!cancelled && !enabled) setStatus("disabled");
    });
    return () => { cancelled = true; };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    resetAccumulator();
    const c = makeController();
    controllerRef.current = c;
    try {
      await c.start();
      return true;
    } catch (err) {
      const e = err as DictationError;
      setError(e.code === "mic" ? "mic_denied" : e.code || "failed");
      controllerRef.current = null;
      return false;
    }
  }, [makeController, resetAccumulator]);

  const stop = useCallback(async (): Promise<string> => {
    const c = controllerRef.current;
    if (!c) return "";
    const text = await c.stop();
    controllerRef.current = null;
    return text.trim();
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    resetAccumulator();
    setStatus("ready");
  }, [resetAccumulator]);

  return { status, error, start, stop, abort };
}