import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SearchIcon, MessageSquareIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useChatHistory } from "../../hooks/useChatHistory";

/**
 * Search bar that lives in the expanded sidebar, directly under the
 * "New Chat" button. Visually identical to {@link NewChatButtonFull}
 * (same height, rounded-full pill, border/bg, gap) so the two stack as a
 * matched pair:
 *
 *   [ +  New Chat                    Ctrl+Shift+O ]
 *   [ 🔍 Search chats…                  Ctrl+K  + ]
 *
 * - Left:  Search icon (mirrors the Plus icon on the New Chat button)
 * - Mid:   real <input>, placeholder "Search chats..."
 * - Right: "Ctrl+K" kbd hint + a small + button that starts a new chat
 *          from inside the search bar.
 *
 * Typing filters the user's chat threads by title and renders the matches
 * in a dropdown anchored below the bar. The dropdown closes on Escape,
 * on outside click, and after a thread is loaded.
 */
export const SidebarSearchBar: FC<{
  /** Called after a thread is selected — used to close the mobile Sheet. */
  onThreadSelected?: () => void;
}> = ({ onThreadSelected }) => {
  const { threads, loadThread } = useChatHistory();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return threads
      .filter((t) => t.title?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [threads, query]);

  const showDropdown = open && query.trim().length > 0;
  const hasResults = results.length > 0;

  const handleSelectThread = useCallback(
    (id: string) => {
      loadThread(id);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      onThreadSelected?.();
    },
    [loadThread, onThreadSelected],
  );

  const handleNewChat = useCallback(() => {
    loadThread(null);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onThreadSelected?.();
  }, [loadThread, onThreadSelected]);

  // Global Ctrl/Cmd+K to focus the search bar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Close the dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        data-testid="sidebar-search-bar"
        className={cn(
          "group h-9 w-full inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-foreground shadow-none",
          "transition-colors focus-within:border-foreground/30",
        )}
      >
        <SearchIcon
          className="size-3.5 shrink-0 text-muted-foreground group-focus-within:text-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                setOpen(false);
                inputRef.current?.blur();
              }
            }
          }}
          placeholder="Search chats..."
          aria-label="Search chats"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground"
        />
        <kbd className="hidden sm:inline-flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
          Ctrl+K
        </kbd>
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
          className="state-layer shrink-0 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50"
          role="listbox"
          aria-label="Search results"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {hasResults ? (
            <div className="max-h-64 overflow-y-auto py-1">
              {results.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => handleSelectThread(thread.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors text-xs text-foreground"
                  role="option"
                >
                  <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{thread.title || "New Chat"}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No chats found
            </div>
          )}
        </div>
      )}
    </div>
  );
};
