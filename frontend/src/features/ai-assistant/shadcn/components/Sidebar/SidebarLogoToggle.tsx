
import { useState, type FC } from "react";
import { PanelLeftClose } from "lucide-react";

/** Shows the Sigma logo normally; on hover it cross-fades into a collapse icon. */
export const SidebarLogoToggle: FC<{ onToggle?: () => void }> = ({ onToggle }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-9 items-center gap-1.5 px-2 rounded-lg transition-colors duration-150 hover:bg-white/8 focus:outline-none font-medium text-sm"
      title="Collapse sidebar"
    >
      {/* Logo SVG — fades out on hover */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className="size-7 transition-all duration-150"
        fill="currentColor"
        style={{
          opacity: hovered ? 0 : 1,
          transform: hovered ? 'scale(0.6)' : 'scale(1)',
          position: 'absolute',
          left: '8px',
        }}
      >
        <g>
          <line x1="50" y1="23" x2="50" y2="77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <path d="M 50 23 L 26 50 L 50 77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M 50 23 L 74 50 L 50 77" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <line x1="74" y1="50" x2="87" y2="37" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
          <line x1="74" y1="50" x2="87" y2="63" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </g>
        <g>
          <circle cx="50" cy="23" r="6.5" fill="currentColor" />
          <circle cx="50" cy="77" r="6.5" fill="currentColor" />
          <circle cx="26" cy="50" r="7.5" fill="currentColor" />
          <circle cx="87" cy="37" r="6.5" fill="currentColor" />
          <circle cx="87" cy="63" r="6.5" fill="currentColor" />
        </g>
      </svg>
      {/* PanelLeftClose — fades in on hover, replacing the logo */}
      <PanelLeftClose
        className="size-4.5 text-zinc-600 transition-all duration-150"
        style={{
          opacity: hovered ? 1 : 0,
          transform: hovered ? 'scale(1)' : 'scale(0.6)',
          position: 'absolute',
          left: '10px',
        }}
      />
      {/* "Sigma" text — always visible, offset right of the icon */}
      <span
        className="pl-8 transition-opacity duration-150"
        style={{ opacity: hovered ? 0.4 : 1 }}
      >
        Sigma
      </span>
    </button>
  );
};
