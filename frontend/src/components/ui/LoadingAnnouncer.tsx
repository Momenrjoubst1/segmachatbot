interface LoadingAnnouncerProps {
  busy: boolean;
  label: string;
}

/**
 * Visually hidden aria-live region that announces loading state changes to screen readers.
 * Render at the top of the app shell (once).
 */
export function LoadingAnnouncer({ busy, label }: LoadingAnnouncerProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {busy ? label : ""}
    </div>
  );
}
