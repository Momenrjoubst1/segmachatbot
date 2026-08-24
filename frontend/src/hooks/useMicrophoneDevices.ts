import { useCallback, useEffect, useRef, useState } from "react";

export interface MicrophoneDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

const STORAGE_DEVICE_KEY = "sigma_selected_mic_device";
const STORAGE_HOLD_KEY = "sigma_hold_to_record";

export function useMicrophoneDevices() {
  const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string>(() => {
    if (typeof localStorage === "undefined") return "";
    return localStorage.getItem(STORAGE_DEVICE_KEY) || "";
  });
  const [holdToRecord, setHoldToRecordState] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_HOLD_KEY) === "true";
  });

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter((d) => d.kind === "audioinput");

      const mapped: MicrophoneDevice[] = audioInputs.map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${index + 1}`,
        isDefault: d.deviceId === "default" || d.label.toLowerCase().includes("default"),
      }));

      setDevices(mapped);

      // If no valid selection or selected device was unplugged, pick default or first
      const stored = localStorage.getItem(STORAGE_DEVICE_KEY);
      const exists = mapped.some((d) => d.deviceId === stored);
      if (!exists && mapped.length > 0) {
        const defaultDev = mapped.find((d) => d.isDefault) || mapped[0];
        setSelectedDeviceIdState(defaultDev.deviceId);
        localStorage.setItem(STORAGE_DEVICE_KEY, defaultDev.deviceId);
      }
    } catch {
      // Ignore if permission not granted yet
    }
  }, []);

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    setSelectedDeviceIdState(deviceId);
    try {
      localStorage.setItem(STORAGE_DEVICE_KEY, deviceId);
    } catch {
      // Storage unavailable
    }
  }, []);

  const setHoldToRecord = useCallback((enabled: boolean) => {
    setHoldToRecordState(enabled);
    try {
      localStorage.setItem(STORAGE_HOLD_KEY, String(enabled));
    } catch {
      // Storage unavailable
    }
  }, []);

  // Request permissions if labels are empty
  const requestPermissionAndRefresh = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop stream immediately after getting permission
      stream.getTracks().forEach((t) => t.stop());
      await refreshDevices();
    } catch {
      // User denied
    }
  }, [refreshDevices]);

  useEffect(() => {
    void refreshDevices();

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    holdToRecord,
    setHoldToRecord,
    refreshDevices,
    requestPermissionAndRefresh,
  };
}

/**
 * Hook to measure live volume from a microphone device for the audio level meter bar.
 */
export function useMicLevelMeter(deviceId: string, active: boolean) {
  const [level, setLevel] = useState(0); // 0 to 1
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active || typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLevel(0);
      return;
    }

    let isCancelled = false;

    async function initMeter() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateLevel = () => {
          if (isCancelled) return;
          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          // Normalize average (0..255) to a pleasant UI scale (0..1)
          const normalized = Math.min(Math.max((average - 10) / 70, 0), 1);
          setLevel(normalized);

          animFrameRef.current = requestAnimationFrame(updateLevel);
        };

        updateLevel();
      } catch {
        setLevel(0);
      }
    }

    void initMeter();

    return () => {
      isCancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
      setLevel(0);
    };
  }, [deviceId, active]);

  return level;
}
