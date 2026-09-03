
import { type FC, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarIcon,
  Mail,
  Lock,
  GlobeIcon,
} from "lucide-react";
import i18n from "@/i18n/i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AnimatedDock } from "@/components/ui/animated-dock";
import { useAgenticAction } from "../../../../../context/AgenticUIBus";
import { ChatFilesButton } from "../../../ui/chat-files-panel";

export interface HeaderProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleEmailHistory?: () => void;
  activeView: 'chat' | 'calendar';
  onToggleView: (view: 'chat' | 'calendar') => void;
  isGuestMode?: boolean;
}

export const Header: FC<HeaderProps> = ({
  onToggleEmailHistory,
  activeView,
  onToggleView,
  isGuestMode = false,
}) => {
  const navigate = useNavigate();
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState('');

  // ─── Octopus: Listen for header-targeted AgenticUI actions ────
  useAgenticAction("header", useCallback((action) => {
    if (action.action === "SET_VIEW") {
      onToggleView(action.payload.view);
    }
  }, [onToggleView]));

  const handleFeatureClick = (feature: string, originalAction: () => void) => {
    if (isGuestMode) {
      setSelectedFeature(feature);
      setShowLoginDialog(true);
    } else {
      originalAction();
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-4">
      <AnimatedDock
        className="h-9 px-2 pb-1.5 bg-white border border-[#EBE5DF] rounded-xl gap-2 flex items-center justify-center shadow-sm mx-0"
        items={[
          {
            onClick: () => handleFeatureClick('calendar', () => onToggleView(activeView === 'calendar' ? 'chat' : 'calendar')),
            Icon: <CalendarIcon className="size-4" />,
            title: "Calendar",
            arrowPath: "M12 0 C12 0, 8 4, 12 8 C16 12, 20 8, 16 14 C12 20, 8 16, 12 22 L10 26 L12 30 L14 26 L12 22"
          },
          {
            onClick: () => handleFeatureClick('email', () => onToggleEmailHistory?.()),
            Icon: <Mail className="size-4" />,
            title: "Email History",
            arrowPath: "M12 0 C12 0, 6 2, 10 6 C14 10, 8 8, 12 12 C16 16, 10 14, 14 18 C18 22, 12 20, 12 24 L10 26 L12 30 L14 26 L12 24"
          }
        ]}
      />
      <div className="ml-auto flex items-center gap-1">
        {/* Language toggle — dir flips to RTL automatically on "ar" (i18next.ts) */}
        <button
          type="button"
          onClick={() => i18n.changeLanguage(i18n.language?.startsWith("ar") ? "en" : "ar")}
          className="state-layer shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors"
          title="Language / اللغة"
          aria-label="Language / اللغة"
        >
          {i18n.language?.startsWith("ar") ? (
            <span className="text-[11px] font-bold">EN</span>
          ) : (
            <GlobeIcon className="size-4" />
          )}
        </button>
        {/* Claude-style: every file attached to this chat, one click away */}
        <ChatFilesButton />
      </div>

      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-2">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <DialogTitle className="text-center">Sign In Required</DialogTitle>
            <DialogDescription className="text-center">
              To access {selectedFeature}, please sign in to your account.
              <br />
              <span className="text-foreground/60 mt-2 block">
                Sign in to unlock all features and enjoy a personalized experience.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={() => navigate('/login')}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => setShowLoginDialog(false)}
              className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
};
