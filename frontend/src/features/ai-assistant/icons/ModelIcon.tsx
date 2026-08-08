import { cn } from "@/lib/cn";
import { type ReactNode } from "react";

export const ModelIcon = ({ children, className }: { children: ReactNode; className?: string }) => {
  return (
    <div 
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[2px]",
        className
      )}
    >
      <div className="flex size-full items-center justify-center">
        {children}
      </div>
    </div>
  );
};
