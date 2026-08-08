
import { type FC, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  CalendarIcon,
  LayoutGrid,
  Mail,
  ShareIcon,
} from "lucide-react";
import { TooltipIconButton } from "../../../ui/tooltip-icon-button";
import { AnimatedDock } from "@/components/ui/animated-dock";
import { useAgenticAction } from "../../../../../context/AgenticUIBus";

export interface HeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleArtifacts: () => void;
  onToggleEmailHistory?: () => void;
  activeView: 'chat' | 'calendar';
  onToggleView: (view: 'chat' | 'calendar') => void;
}

export const Header: FC<HeaderProps> = ({
  onToggleArtifacts,
  onToggleEmailHistory,
  activeView,
  onToggleView,
}) => {
  const navigate = useNavigate();

  // ─── Octopus: Listen for header-targeted AgenticUI actions ────
  useAgenticAction("header", useCallback((action) => {
    if (action.action === "SET_VIEW") {
      onToggleView(action.payload.view);
    }
  }, [onToggleView]));

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-4">
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip="Back to Home"
        side="bottom"
        onClick={() => navigate("/")}
        className="size-9"
      >
        <ArrowLeftIcon className="size-4" />
      </TooltipIconButton>
      <AnimatedDock
        className="h-10 px-2 pb-1.5 bg-neutral-900/40 border border-white/5 rounded-xl gap-2 flex items-center justify-center shadow-none mx-0"
        items={[
          {
            onClick: () => onToggleView(activeView === 'calendar' ? 'chat' : 'calendar'),
            Icon: <CalendarIcon className="size-4" />,
            title: "Calendar"
          },
          {
            onClick: onToggleArtifacts,
            Icon: <LayoutGrid className="size-4" />,
            title: "Artifacts"
          },
          {
            onClick: onToggleEmailHistory,
            Icon: <Mail className="size-4" />,
            title: "Email History"
          }
        ]}
      />
      <TooltipIconButton
        variant="ghost"
        size="icon"
        tooltip="Share"
        side="bottom"
        className="ml-auto size-9"
      >
        <ShareIcon className="size-4" />
      </TooltipIconButton>
    </header>
  );
};
