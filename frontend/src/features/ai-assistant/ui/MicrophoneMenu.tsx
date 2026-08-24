import { type FC, useState, useRef, useEffect } from "react";
import {
  MicIcon,
  ChevronDownIcon,
  CheckIcon,
  PointerIcon,
  Loader2Icon,
  SquareIcon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";
import { useTranslation } from "react-i18next";
import { useMicrophoneDevices, useMicLevelMeter } from "@/hooks/useMicrophoneDevices";
import { voiceSoundEffects } from "@/lib/audio/voice-sound-effects";

interface MicrophoneMenuProps {
  className?: string;
  dictRecording: boolean;
  dictStatus: string;
  dictError: string | null;
  liveActive: boolean;
  seconds: number;
  onStartDict: () => Promise<void>;
  onStopDict: () => Promise<void>;
}

export const MicrophoneMenu: FC<MicrophoneMenuProps> = ({
  className,
  dictRecording,
  dictStatus,
  liveActive,
  seconds,
  onStartDict,
  onStopDict,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    holdToRecord,
    setHoldToRecord,
    requestPermissionAndRefresh,
  } = useMicrophoneDevices();

  // Active mic audio level meter when menu is open or recording
  const micLevel = useMicLevelMeter(selectedDeviceId, open || dictRecording);

  // Request permission once menu is opened if device labels are blank
  useEffect(() => {
    if (open && devices.some((d) => d.label.startsWith("Microphone "))) {
      void requestPermissionAndRefresh();
    }
  }, [open, devices, requestPermissionAndRefresh]);

  // Hold-to-record interaction handling
  const isHoldingRef = useRef(false);

  const handlePointerDown = async () => {
    if (!holdToRecord) return;
    if (liveActive || dictStatus === "starting" || dictStatus === "stopping") return;
    isHoldingRef.current = true;
    voiceSoundEffects.playActivate();
    await onStartDict();
  };

  const handlePointerUp = async () => {
    if (!holdToRecord) return;
    if (isHoldingRef.current) {
      isHoldingRef.current = false;
      voiceSoundEffects.playDeactivate();
      await onStopDict();
    }
  };

  const handleClick = async () => {
    if (holdToRecord) return; // Managed by pointer events
    if (liveActive) return;
    if (dictRecording || dictStatus === "stopping") {
      voiceSoundEffects.playDeactivate();
      await onStopDict();
      return;
    }
    if (dictStatus !== "ready") return;
    voiceSoundEffects.playActivate();
    await onStartDict();
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group relative inline-flex items-center rounded-full transition-all duration-200 ease-out",
          "p-0.5 hover:bg-neutral-200/80 dark:hover:bg-neutral-800",
          open && "bg-neutral-200/80 dark:bg-neutral-800",
          dictRecording && "bg-rose-500/10 dark:bg-rose-950/30",
          liveActive && "opacity-40 pointer-events-none",
          className,
        )}
      >
        {/* ── Chevron Options Trigger (reveals on hover or when open) ── */}
        <div
          className={cn(
            "flex items-center overflow-hidden transition-all duration-200 ease-out",
            open
              ? "max-w-[28px] opacity-100 pl-0.5"
              : "max-w-0 opacity-0 group-hover:max-w-[28px] group-hover:opacity-100 group-hover:pl-0.5 pointer-events-none group-hover:pointer-events-auto",
          )}
        >
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Microphone settings"
              className={cn(
                "flex items-center justify-center size-7 rounded-full text-neutral-500 dark:text-neutral-400",
                "hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-300/60 dark:hover:bg-neutral-700/80",
                "transition-colors duration-150 cursor-pointer focus:outline-none",
                open && "bg-neutral-300/70 dark:bg-neutral-700/90 text-neutral-900 dark:text-white",
              )}
            >
              <ChevronDownIcon
                className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
              />
            </button>
          </DropdownMenu.Trigger>

          {/* Micro vertical divider */}
          <div className="h-3.5 w-px bg-neutral-300 dark:bg-neutral-700 mx-0.5 shrink-0" aria-hidden="true" />
        </div>

        {/* ── Mic Action Button ── */}
        <button
          type="button"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          disabled={liveActive || dictStatus === "starting" || dictStatus === "stopping"}
          aria-label={dictRecording ? t("voice.stop", { defaultValue: "Stop recording" }) : t("voice.start", { defaultValue: "Start recording" })}
          aria-pressed={dictRecording}
          data-testid="mic-button"
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300",
            "hover:text-neutral-900 dark:hover:text-white hover:scale-105 active:scale-95",
            "transition-all duration-200 cursor-pointer focus:outline-none",
            dictRecording &&
              "animate-pulse bg-rose-500/20 text-rose-600 hover:bg-rose-500/30 hover:text-rose-600 dark:text-rose-400",
            !liveActive &&
              (dictStatus === "starting" || dictStatus === "stopping") &&
              "cursor-wait opacity-60",
          )}
        >
          {dictStatus === "starting" || dictStatus === "stopping" ? (
            <Loader2Icon className="size-5 animate-spin stroke-[1.5px]" />
          ) : dictRecording ? (
            <SquareIcon className="size-4 fill-current" />
          ) : (
            <MicIcon className="size-5 stroke-[1.5px]" />
          )}

          {dictRecording && seconds > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1 text-[8px] font-bold text-white shadow-sm">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
          )}
        </button>
      </div>

      {/* ── Floating Claude-style Microphone Popover Menu ───────── */}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          sideOffset={6}
          align="end"
          avoidCollisions={false}
          className={cn(
            "z-[99999] w-72 sm:w-80 rounded-2xl p-2 shadow-2xl",
            "bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800",
            "text-neutral-800 dark:text-neutral-200 select-none",
            "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          )}
        >
          {/* ── Header: Mic Icon + Live Audio Level Meter ──────── */}
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <MicIcon className="size-4 text-neutral-500 shrink-0" />
            <div className="flex-1 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-75 ease-out"
                style={{
                  width: `${Math.max(micLevel * 100, 4)}%`,
                  opacity: micLevel > 0.05 ? 1 : 0.4,
                }}
              />
            </div>
          </div>

          {/* ── Microphone Device Items List ───────────────────── */}
          <div className="max-h-60 overflow-y-auto space-y-0.5 py-0.5">
            {devices.length === 0 ? (
              <div className="px-3 py-2 text-xs text-neutral-400">
                {t("voice.no_devices_found", { defaultValue: "No microphones found" })}
              </div>
            ) : (
              devices.map((device) => {
                const isSelected =
                  device.deviceId === selectedDeviceId ||
                  (!selectedDeviceId && device.isDefault);

                return (
                  <DropdownMenu.Item
                    key={device.deviceId}
                    onSelect={() => setSelectedDeviceId(device.deviceId)}
                    className={cn(
                      "flex items-center justify-between w-full px-3 py-2 text-[13px] rounded-xl cursor-pointer outline-none transition-colors duration-150",
                      "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200",
                      "focus:bg-neutral-100 dark:focus:bg-neutral-800",
                      isSelected && "font-medium text-neutral-900 dark:text-white",
                    )}
                  >
                    <span className="truncate pr-2">{device.label}</span>
                    {isSelected && (
                      <CheckIcon className="size-4 text-blue-500 shrink-0 stroke-[2.5px]" />
                    )}
                  </DropdownMenu.Item>
                );
              })
            )}
          </div>

          {/* ── Divider ────────────────────────────────────────── */}
          <div className="my-1.5 h-px bg-neutral-200/80 dark:bg-neutral-800" />

          {/* ── Footer: Hold to Record Toggle ──────────────────── */}
          <div
            className="flex items-center justify-between px-3 py-2 rounded-xl text-[13px] text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors cursor-pointer"
            onClick={() => setHoldToRecord(!holdToRecord)}
          >
            <div className="flex items-center gap-2.5">
              <PointerIcon className="size-4 text-neutral-500 rotate-12" />
              <span>{t("voice.hold_to_record", { defaultValue: "Hold to record" })}</span>
            </div>

            {/* Custom Toggle Switch */}
            <button
              type="button"
              role="switch"
              aria-checked={holdToRecord}
              onClick={(e) => {
                e.stopPropagation();
                setHoldToRecord(!holdToRecord);
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                holdToRecord ? "bg-blue-600" : "bg-neutral-300 dark:bg-neutral-700",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                  holdToRecord ? "translate-x-4" : "translate-x-0",
                )}
              />
            </button>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
