const APP_SKELETON_BUBBLES: { side: "left" | "right"; w: number }[] = [
  { side: "right", w: 55 },
  { side: "left", w: 75 },
  { side: "right", w: 40 },
  { side: "left", w: 85 },
  { side: "left", w: 60 },
];

export function AppSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex h-screen h-[100dvh] w-full bg-background text-foreground"
    >
      {/* Sidebar skeleton — matches w-65 (260px) */}
      <div className="hidden md:flex w-65 shrink-0 flex-col border-r border-border bg-background p-4 gap-4">
        <div className="h-7 w-24 rounded-md bg-muted animate-pulse" />
        <div className="h-9 w-full rounded-xl bg-muted animate-pulse" />
        <div className="flex flex-col gap-2 mt-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="h-8 rounded-lg bg-muted animate-pulse"
              style={{ width: `${70 + (i % 3) * 10}%`, animationDelay: `${i * 60}ms` }}
            />
          ))}
        </div>
      </div>

      {/* Chat area skeleton */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className="h-5 w-5 rounded bg-muted animate-pulse" />
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        </div>

        {/* Messages area — aligned with ThreadSwitchSkeleton presets */}
        <div className="flex flex-1 flex-col justify-end gap-3 p-6 pb-4">
          {APP_SKELETON_BUBBLES.map(({ side, w }, i) => (
            <div
              key={i}
              className={`flex ${side === "right" ? "justify-end" : "justify-start"}`}
            >
              <div
                aria-hidden="true"
                className="h-9 rounded-2xl bg-muted animate-pulse"
                style={{ width: `${w}%`, maxWidth: "360px", animationDelay: `${i * 60}ms` }}
              />
            </div>
          ))}
        </div>

        {/* Composer skeleton */}
        <div className="px-4 pb-5">
          <div className="h-12 rounded-2xl bg-muted animate-pulse border border-border" />
        </div>
      </div>
    </div>
  );
}
