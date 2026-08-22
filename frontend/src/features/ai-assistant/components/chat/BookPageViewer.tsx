import { useState } from "react";
import { cn } from "@/lib/cn";
import { useTranslation } from "react-i18next";
import { useTextbooks } from "@/hooks/useTextbooks";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { XIcon } from "lucide-react";

interface BookPageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  textbookId: string | undefined;
  page: number | undefined;
  sourceName: string;
}

export function BookPageViewer({
  open,
  onOpenChange,
  textbookId,
  page,
  sourceName,
}: BookPageViewerProps) {
  const { t } = useTranslation("chat");
  const { textbooks } = useTextbooks();

  const textbook = textbooks.find((tb) => tb.id === textbookId);
  const fileUrl = textbook?.file_url;
  const hasPage = typeof page === "number" && page > 0;

  if (!fileUrl) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0">
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b">
          <DialogTitle className="text-sm font-medium truncate">
            {t("sources.viewerTitle", { name: sourceName, page: hasPage ? page : "" })}
          </DialogTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 hover:bg-muted transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <iframe
            src={hasPage ? `${fileUrl}#page=${page}` : fileUrl}
            className="w-full h-full border-0"
            title={sourceName}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
