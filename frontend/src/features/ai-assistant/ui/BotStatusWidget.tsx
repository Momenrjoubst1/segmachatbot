
import { type FC } from "react";
import { useBotStatus, type BotStatus } from "./useBotStatus";

const statusConfig: Record<BotStatus, { icon: string; gradient: string } | null> = {
  idle: null,
  thinking: {
    icon: "🧠",
    gradient: "from-violet-500/20 to-purple-500/20",
  },
  searching: {
    icon: "🔍",
    gradient: "from-blue-500/20 to-cyan-500/20",
  },
  generating: null,
};

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]">
      <span className="inline-block size-[5px] rounded-full bg-primary/60 animate-[dotPulse_1.2s_ease-in-out_infinite]" />
      <span className="inline-block size-[5px] rounded-full bg-primary/60 animate-[dotPulse_1.2s_ease-in-out_0.2s_infinite]" />
      <span className="inline-block size-[5px] rounded-full bg-primary/60 animate-[dotPulse_1.2s_ease-in-out_0.4s_infinite]" />
    </span>
  );
}

export const BotStatusWidget: FC = () => {
  const { status, label } = useBotStatus();

  if (status === "idle" || status === "generating") return null;

  const config = statusConfig[status];
  if (!config) return null;

  return (
    <div className="bot-status-widget flex items-center gap-2.5 mt-2 mb-1 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div
        className={`relative flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${config.gradient} border border-border/30`}
      >
        <span className="text-sm">{config.icon}</span>
        <span className="text-sm font-medium text-muted-foreground">
          {label || "Processing..."}
        </span>
        <ThinkingDots />
      </div>
    </div>
  );
};

BotStatusWidget.displayName = "BotStatusWidget";
