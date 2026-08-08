import * as React from "react";
import { cn } from "@/lib/cn";
import styles from "./BarsSpinner.module.css";

interface BarsSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  color?: string;
}

export const BarsSpinner = React.forwardRef<HTMLDivElement, BarsSpinnerProps>(
  ({ className, size = 20, color = "currentColor", ...props }, ref) => {
    const bars = Array(12).fill(0);

    return (
      <div
        ref={ref}
        className={cn(styles.wrapper, className)}
        style={{
          ["--spinner-size" as string]: `${size}px`,
          ["--spinner-color" as string]: color,
        }}
        {...props}
      >
        <div className={styles.spinner}>
          {bars.map((_, i) => (
            <div className={styles.bar} key={`spinner-bar-${i}`} />
          ))}
        </div>
      </div>
    );
  },
);

BarsSpinner.displayName = "SpellUI.BarsSpinner";

export type { BarsSpinnerProps };
