/**
 * A thin top-loading progress bar (YouTube/Notion/Gemini style).
 * Positioned at the top of its container with an indeterminate sliding animation.
 */
export const TopLoadingBar = () => {
  return (
    <div
      role="progressbar"
      aria-valuetext="Loading messages"
      className="absolute top-0 left-0 right-0 z-50 h-1 overflow-hidden"
    >
      <div
        className="h-full w-full origin-left bg-gradient-to-r from-primary/80 via-primary to-primary/80"
        style={{ animation: "loading-bar 1.5s ease-in-out infinite" }}
      />
    </div>
  );
};
