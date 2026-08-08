
import { type FC } from "react";

export const CursorBlinker: FC = () => {
  return (
    <span
      className="cursor-blinker inline-block w-[2px] h-[1.1em] bg-primary/70 ml-[1px] align-middle animate-[cursorBlink_1s_step-end_infinite]"
      aria-hidden="true"
    />
  );
};

CursorBlinker.displayName = "CursorBlinker";
