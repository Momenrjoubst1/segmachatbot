import React from "react";

export type FrameId = "none" | "gold" | "silver" | "bronze" | string;

interface AvatarFrameProps {
  frameId: FrameId;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const frameStyles: Record<string, string> = {
  gold: "ring-2 ring-yellow-400 ring-offset-2",
  silver: "ring-2 ring-gray-300 ring-offset-2",
  bronze: "ring-2 ring-orange-400 ring-offset-2",
};

export const AvatarFrame: React.FC<AvatarFrameProps> = ({
  frameId,
  size: _size = "md",
  children,
}) => {
  const frameClass = frameStyles[frameId] || "";

  return (
    <div className={`relative inline-block ${frameClass}`}>
      {children}
    </div>
  );
};

export default AvatarFrame;
