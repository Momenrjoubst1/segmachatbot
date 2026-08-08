import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-3",
    lg: "h-12 w-12 border-4",
  };

  return (
    <div
      className={cn(
        "animate-spin rounded-full border-primary border-t-transparent",
        sizeClasses[size],
        className
      )}
    />
  );
}

interface LoadingOverlayProps {
  message?: string;
  className?: string;
}

export function LoadingOverlay({ message, className }: LoadingOverlayProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 p-8",
        className
      )}
    >
      <LoadingSpinner size="lg" />
      {message && (
        <p className="text-sm text-muted-foreground animate-pulse">{message}</p>
      )}
    </div>
  );
}

interface LoadingCardProps {
  message?: string;
  className?: string;
}

export function LoadingCard({ message = "Loading...", className }: LoadingCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 bg-card rounded-2xl border border-border",
        className
      )}
    >
      <LoadingSpinner size="md" className="mb-4" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export const MessageSkeleton = () => {
  return (
    <div className="flex flex-col gap-6 px-6 pb-4" dir="ltr">
      <div
        style={{ animation: "fadeInUp 0.3s ease-in-out both" }}
        className="flex justify-end"
      >
        <div className="max-w-[85%] rounded-2xl bg-muted/50 px-4 py-3">
          <div className="h-4 w-48 bg-border rounded animate-pulse" />
        </div>
      </div>

      <div
        style={{ animation: "fadeInUp 0.3s ease-in-out 0.1s both" }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary/50 rounded-full animate-pulse [animation-delay:0ms]" />
          <div className="w-2 h-2 bg-primary/50 rounded-full animate-pulse [animation-delay:200ms]" />
          <div className="w-2 h-2 bg-primary/50 rounded-full animate-pulse [animation-delay:400ms]" />
          <span className="text-sm text-muted-foreground/60">Thinking...</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="h-4 w-full bg-border rounded animate-pulse" />
          <div className="h-4 w-[90%] bg-border rounded animate-pulse [animation-delay:100ms]" />
          <div className="h-4 w-[75%] bg-border rounded animate-pulse [animation-delay:200ms]" />
        </div>
      </div>
    </div>
  );
};

export function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "flex gap-3",
            i % 2 === 0 && "flex-row-reverse"
          )}
        >
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className={cn("space-y-2", i % 2 === 0 ? "items-end" : "")}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-64 rounded-2xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

const BUBBLE_PRESETS: { side: "left" | "right"; w: number }[] = [
  { side: "right", w: 65 },
  { side: "left", w: 80 },
  { side: "right", w: 40 },
  { side: "left", w: 90 },
  { side: "left", w: 55 },
  { side: "right", w: 70 },
  { side: "left", w: 85 },
  { side: "right", w: 50 },
];

function fallbackBubbleSpecs(count = 5) {
  const offset = Math.floor(Date.now() / 60000) % BUBBLE_PRESETS.length;
  return Array.from({ length: count }, (_, i) => BUBBLE_PRESETS[(i + offset) % BUBBLE_PRESETS.length]);
}

export const CompactSkeleton = () => {
  const specs = fallbackBubbleSpecs();
  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex-1 min-h-0 flex flex-col justify-end gap-3 p-6 pb-4 overflow-hidden">
        {specs.map(({ side, w }, i) => (
          <div
            key={i}
            style={{ animation: `${side === "right" ? "fadeInLeft" : "fadeInRight"} 0.3s ease-in-out ${i * 0.05}s both` }}
            className={cn("flex", side === "right" ? "justify-end" : "justify-start")}
          >
            <div
              className="h-9 rounded-2xl bg-border animate-pulse"
              style={{
                width: `${w}%`,
                maxWidth: "360px",
                animationDelay: `${i * 80}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="px-4 pb-5 shrink-0">
        <div
          style={{ animation: "fadeInUp 0.3s ease-in-out 0.3s both" }}
          className="h-12 rounded-2xl bg-muted animate-pulse border border-border"
        />
      </div>
    </motion.div>
  );
};
