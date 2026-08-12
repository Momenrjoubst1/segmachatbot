import { cn } from "@/lib/cn";

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Visually hidden label for screen readers */
  "aria-label"?: string;
}

export function LoadingSpinner({ size = "md", className, ...props }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-3",
    lg: "h-12 w-12 border-4",
  };

  return (
    <div
      role="status"
      className={cn(
        "animate-spin rounded-full border-primary border-t-transparent",
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}

const THREAD_SWITCH_BUBBLES: { side: "left" | "right"; w: number }[] = [
  { side: "right", w: 55 },
  { side: "left", w: 75 },
  { side: "right", w: 40 },
  { side: "left", w: 85 },
  { side: "left", w: 60 },
];

export const ThreadSwitchSkeleton = () => {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-full w-full flex-col bg-background"
    >
      <div className="flex-1 min-h-0 flex flex-col justify-end gap-3 p-6 pb-4 overflow-hidden">
        {THREAD_SWITCH_BUBBLES.map(({ side, w }, i) => (
          <div
            key={i}
            className={cn("flex", side === "right" ? "justify-end" : "justify-start")}
          >
            <div
              aria-hidden="true"
              className="h-9 rounded-2xl bg-border animate-pulse"
              style={{
                width: `${w}%`,
                maxWidth: "360px",
                animationDelay: `${i * 60}ms`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
