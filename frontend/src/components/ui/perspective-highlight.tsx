
import { cn } from "@/lib/cn";
import { useEffect, useRef } from "react";
import styles from "./perspective-highlight.module.css";

/**
 * How many pixels OUTSIDE the card bounding-box still count as
 * the "active zone". Beyond this, the tilt resets to 0.
 */
const ACTIVE_ZONE_PADDING = 180;

interface PerspectiveProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Max rotateX in degrees. Default 14. */
  maxRotateX?: number;
  /** Max rotateY in degrees. Default 30. */
  maxRotateY?: number;
  /** Lerp factor 0–1. Higher = snappier follow. Default 0.12. */
  smoothing?: number;
  /** Custom class for the inner transform card container */
  cardClassName?: string;
}

export const Perspective = ({
  maxRotateX = 14,
  maxRotateY = 30,
  smoothing = 0.12,
  className,
  cardClassName,
  children,
  ...props
}: PerspectiveProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const card = cardRef.current;
    if (!container || !card) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let targetX = 0;
    let targetY = 0;
    let rotX = 0;
    let rotY = 0;
    let raf = 0;

    const onMove = (e: MouseEvent) => {
      const r = card.getBoundingClientRect();

      // ── Zone check ──────────────────────────────────────────────────────────
      // The effect is only active when the cursor is inside the card + padding.
      // Outside that zone everything resets to 0 smoothly.
      const inZone =
        e.clientX >= r.left  - ACTIVE_ZONE_PADDING &&
        e.clientX <= r.right + ACTIVE_ZONE_PADDING &&
        e.clientY >= r.top   - ACTIVE_ZONE_PADDING &&
        e.clientY <= r.bottom + ACTIVE_ZONE_PADDING;

      if (!inZone) {
        targetX = 0;
        targetY = 0;
        return;
      }

      // ── Rotation strength ────────────────────────────────────────────────
      // Normalised position relative to card centre (-1 … +1).
      const dx = (e.clientX - (r.left + r.width  / 2)) / (r.width  / 2);
      const dy = (e.clientY - (r.top  + r.height / 2)) / (r.height / 2);

      // Full strength inside the card, fade linearly across the padding band.
      const overX = Math.max(0, Math.abs(dx) - 1) * (r.width  / 2);
      const overY = Math.max(0, Math.abs(dy) - 1) * (r.height / 2);
      const falloff = Math.min(
        1 - overX / ACTIVE_ZONE_PADDING,
        1 - overY / ACTIVE_ZONE_PADDING,
        1,
      );

      targetX = clamp(dy, -1, 1) * maxRotateX * falloff;
      targetY = -clamp(dx, -1, 1) * maxRotateY * falloff;
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    const tick = () => {
      rotX += (targetX - rotX) * smoothing;
      rotY += (targetY - rotY) * smoothing;

      const lift = Math.min(
        1,
        Math.hypot(rotX / maxRotateX, rotY / maxRotateY),
      );

      container.style.setProperty("--rx",   `${rotX.toFixed(2)}deg`);
      container.style.setProperty("--ry",   `${rotY.toFixed(2)}deg`);
      container.style.setProperty("--lift", lift.toFixed(3));

      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    tick();

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, [maxRotateX, maxRotateY, smoothing]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "[perspective:1200px] motion-safe:animate-perspective-blur-in",
        className,
      )}
      style={{ pointerEvents: "none" }}
      {...props}
    >
      {/*
        * transform-style:preserve-3d must NOT have overflow:hidden (it breaks
        * the 3D context in most browsers). Instead we rely on very small
        * rotation values (maxRotateX=1, maxRotateY=5 in the chatbot) so the
        * card never physically leaves its layout box.
        */}
      <div className="[transform-style:preserve-3d]" style={{ pointerEvents: "none" }}>
        <div
          ref={cardRef}
          className={cn("max-w-[480px] p-10 will-change-transform", cardClassName)}
          style={{
            transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            pointerEvents: "auto",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

type HighlightColor = "red" | "purple" | "green";

interface HighlightProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Color preset. Default "green". */
  color?: HighlightColor;
}

export const Highlight = ({
  color = "green",
  className,
  style,
  children,
  ...props
}: HighlightProps) => {
  return (
    <>
      <span
        className={cn(
          "inline-block rounded-[3px] px-1 text-white will-change-[transform,box-shadow]",
          styles.highlightComponent,
          className,
        )}
        style={{
          background: `var(--perspective-${color}-bg)`,
          transform:
            "translate(calc(-3px * var(--lift, 0)), calc(-2.5px * var(--lift, 0)))",
          boxShadow: `var(--highlight-shadow)`,
          ...style,
        }}
        {...props}
      >
        {children}
      </span>
    </>
  );
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
