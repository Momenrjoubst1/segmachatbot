import { type FC, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { SearchIcon, X } from "lucide-react";
import { ChatIcon } from "@/components/ui/chat-icon";
import { useChatHistory } from "../../../../../hooks/useChatHistory";

const getTimeLabel = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1) return "Today";
  if (diffDays < 2) return "Yesterday";
  if (diffDays < 7) return "Past week";
  return "Past month";
};

export const SearchDialog: FC = () => {
  const { threads, loadThread } = useChatHistory();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Drag state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const filteredThreads = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return threads.filter((t) =>
      t.title?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [threads, query]);

  const handleSelectThread = useCallback((id: string) => {
    loadThread(id);
    setOpen(false);
    setQuery("");
    setPosition({ x: 0, y: 0 });
  }, [loadThread]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setPosition({ x: 0, y: 0 });
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target.closest('button')) return;
    if (!dialogRef.current) return;

    const rect = dialogRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Listen for open-search custom event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-search', handler);
    return () => window.removeEventListener('open-search', handler);
  }, []);

  // Focus search input when dialog opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Global Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  const displayThreads = query.trim() ? filteredThreads : threads.slice(0, 10);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10"
        onClick={handleClose}
      />
      {/* Dialog */}
      <div
        ref={dialogRef}
        className="absolute w-full max-w-2xl bg-white border border-[#EBE5DF] rounded-2xl shadow-xl overflow-hidden"
        style={{
          left: position.x || '50%',
          top: position.y || '15vh',
          transform: position.x === 0 && position.y === 0 ? 'translateX(-50%)' : 'none',
        }}
      >
        {/* Search input — drag handle */}
        <div
          className={`flex items-center gap-3 px-4 py-3 border-b border-[#EBE5DF] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={handleMouseDown}
        >
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" style={{ animation: "searchPulse 1.5s ease-in-out infinite" }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats and projects"
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground cursor-text"
          />
          <button
            type="button"
            onClick={handleClose}
            className="shrink-0 inline-flex items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-[#F9F6F0] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {displayThreads.length > 0 ? (
            displayThreads.map((thread) => {
              const timeLabel = getTimeLabel(thread.updated_at);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleSelectThread(thread.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#F9F6F0] rounded-lg transition-colors"
                >
                  <ChatIcon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm text-foreground truncate">{thread.title || "New Chat"}</span>
                  {timeLabel && (
                    <span className="text-xs text-muted-foreground shrink-0">{timeLabel}</span>
                  )}
                </button>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No chats found</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
