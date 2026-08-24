import { useEffect, useRef, useState, type FC } from "react";
import {
  CameraIcon,
  CheckIcon,
  GlobeIcon,
  PaperclipIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAui } from "@assistant-ui/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { installFileInputValidation } from "./attachment";

const WEB_SEARCH_STORAGE_KEY = "sigma:web-search";

/**
 * Whether the Web-search tool is enabled for new messages.
 * Read by the send path (useChatRuntime) and toggled from the + menu.
 */
export function isWebSearchEnabled(): boolean {
  try {
    return localStorage.getItem(WEB_SEARCH_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Claude-style "+" composer menu:
 *  - Add files or photos (opens the file picker, attachments flow as usual)
 *  - Take a screenshot (captures the screen via getDisplayMedia, attaches PNG)
 *  - Web search (on/off toggle, sent with every chat request)
 *
 * "Add to project", "Skills", "Connectors" and "Add plugins" are
 * intentionally omitted — the app has no such features yet.
 */
export const ComposerPlusMenu: FC = () => {
  const aui = useAui();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webSearch, setWebSearch] = useState(isWebSearchEnabled);

  useEffect(() => {
    installFileInputValidation();
  }, []);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const composer = aui.thread().composer();
    for (const file of Array.from(files)) {
      try {
        await composer.addAttachment(file);
      } catch (err) {
        toast.error((err as Error)?.message ?? "Failed to add attachment");
      }
    }
  };

  const takeScreenshot = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen capture is not supported in this browser");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Failed to capture screenshot");
      const file = new File([blob], `screenshot-${Date.now()}.png`, {
        type: "image/png",
      });
      await aui.thread().composer().addAttachment(file);
    } catch (err) {
      // AbortError = the user dismissed the picker — not an error.
      if ((err as Error)?.name !== "AbortError") {
        toast.error((err as Error)?.message ?? "Screenshot failed");
      }
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  };

  const toggleWebSearch = () => {
    const next = !webSearch;
    setWebSearch(next);
    try {
      localStorage.setItem(WEB_SEARCH_STORAGE_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <>
      {/* Hidden input drives the "Add files or photos" item */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="state-layer aui-composer-add-attachment inline-flex size-10 items-center justify-center rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Add attachments and tools"
          >
            <PlusIcon className="aui-attachment-add-icon size-5 stroke-[1.5px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="aui-plus-menu min-w-[260px] rounded-xl p-1"
        >
          <DropdownMenuItem
            onClick={() => fileInputRef.current?.click()}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
          >
            <PaperclipIcon className="size-4 text-zinc-500" />
            <span className="flex-1 font-medium text-zinc-900">Add files or photos</span>
            <span className="text-[11px] text-zinc-500">Ctrl+U</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void takeScreenshot()}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
          >
            <CameraIcon className="size-4 text-zinc-500" />
            <span className="flex-1 font-medium text-zinc-900">Take a screenshot</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            onClick={toggleWebSearch}
            data-testid="web-search-toggle"
            aria-checked={webSearch}
            role="menuitemcheckbox"
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px]"
          >
            <GlobeIcon className="size-4 text-zinc-500" />
            <span className="flex-1 font-medium text-zinc-900">Web search</span>
            {webSearch && <CheckIcon className="size-4 text-blue-600" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
