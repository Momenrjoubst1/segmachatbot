
import {
  memo,
  useState,
  createContext,
  useContext,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAssistantContext } from "@assistant-ui/react";
import { cn } from "@/lib/cn";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "./select";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
  /** Effort levels supported by this model — empty/omitted = no Effort row. */
  efforts?: string[];
};

export type ModelEffort = string;

const EFFORTS_STORAGE_KEY = "sigma_model_efforts";
const THINKING_STORAGE_KEY = "sigma_model_thinking";

type EffortRecord = Record<string, string>;

function loadStoredEfforts(): EffortRecord {
  try {
    const raw = localStorage.getItem(EFFORTS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as EffortRecord;
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return {};
}

function loadStoredThinking(): boolean {
  try {
    return localStorage.getItem(THINKING_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Default effort for a model: "Medium" when available, else the middle level. */
function defaultEffortFor(efforts: string[]): string {
  if (efforts.includes("Medium")) return "Medium";
  return efforts[Math.floor((efforts.length - 1) / 2)] ?? "Medium";
}

type ModelSelectorContextValue = {
  models: ModelOption[];
  value: string | undefined;
  featuredCount?: number;
  showAll?: boolean;
  setShowAll?: (v: boolean) => void;
  showEffort?: boolean;
  /** Effort levels supported by the currently selected model. */
  efforts?: string[];
  effort?: string;
  setEffort?: (e: string) => void;
  defaultEffort?: string;
  thinking?: boolean;
  setThinking?: (v: boolean) => void;
  effortOpen?: boolean;
  setEffortOpen?: (v: boolean) => void;
};

const ModelSelectorContext = createContext<ModelSelectorContextValue | null>(
  null,
);

function useModelSelectorContext() {
  const ctx = useContext(ModelSelectorContext);
  if (!ctx) {
    throw new Error(
      "ModelSelector sub-components must be used within ModelSelector.Root",
    );
  }
  return ctx;
}

export type ModelSelectorRootProps = {
  models: ModelOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
};

function ModelSelectorRoot({
  models,
  children,
  value,
  ...selectProps
}: ModelSelectorRootProps) {
  // `models` is kept in the signature for API compatibility; the context
  // (including featured/effort state) is provided by ModelSelectorImpl.
  void models;
  return (
    <Select
      value={value}
      {...selectProps}
    >
      {children}
    </Select>
  );
}

export type ModelSelectorTriggerProps = ComponentPropsWithoutRef<
  typeof SelectTrigger
>;

function ModelSelectorTrigger({
  className,
  size,
  children,
  ...props
}: ModelSelectorTriggerProps) {
  return (
    <SelectTrigger
      data-slot="model-selector-trigger"
      size={size}
      /* Claude-style: plain text trigger — no border, background or shadow. */
      className={cn(
        "aui-model-selector-trigger rounded-full border-0 bg-transparent px-2 shadow-none transition-colors hover:bg-[#F0EDE6] focus-visible:border-0 focus-visible:ring-0",
        className,
      )}
      {...props}
    >
      {children ?? <ModelSelectorValue />}
    </SelectTrigger>
  );
}

/**
 * Renders the selected model display in the trigger.
 *
 * Bypasses Radix Select.Value to avoid the empty-on-SSR issue caused by
 * Select items living inside a Portal (not rendered server-side).
 * Falls back to Select.Value for uncontrolled (defaultValue-only) usage.
 */
function ModelSelectorValue() {
  const { models, value, showEffort, effort } = useModelSelectorContext();
  const selectedModel =
    value != null ? models.find((m) => m.id === value) : undefined;

  if (!selectedModel) {
    return <SelectPrimitive.Value />;
  }

  return (
    <span>
      <span className="flex items-center gap-1.5">
        <span className="truncate font-medium">{selectedModel.name}</span>
        {showEffort && effort && (
          <span className="text-xs text-zinc-500">{effort}</span>
        )}
      </span>
    </span>
  );
}

export type ModelSelectorContentProps = ComponentPropsWithoutRef<
  typeof SelectContent
>;

function ModelSelectorContent({
  className,
  children,
  ...props
}: ModelSelectorContentProps) {
  const { models, featuredCount, showAll, setShowAll, showEffort, effortOpen, setEffortOpen } =
    useModelSelectorContext();
  const { t } = useTranslation();
  // Keeps the effort submenu open while the pointer is anywhere inside the
  // menu (including the submenu itself — it's a DOM descendant), closing it
  // shortly after the pointer leaves the menu entirely.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelEffortClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleEffortClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setEffortOpen?.(false), 200);
  };
  useEffect(() => cancelEffortClose, []);

  const collapsed = featuredCount != null && !showAll;
  const visibleModels = collapsed
    ? models.slice(0, featuredCount)
    : models;
  const hiddenCount = collapsed ? models.length - (featuredCount ?? 0) : 0;

  return (
    <SelectContent
      position="popper"
      /* Claude-style placement: prefer BELOW the trigger (welcome screen),
         but let the popper flip ABOVE it when the composer sits at the
         bottom of the viewport (chat view) — exactly like Claude. The
         content is capped by --radix-select-content-available-height for
         whichever side wins and scrolls if needed. */
      side="bottom"
      sideOffset={4}
      data-slot="model-selector-content"
      className={cn(
        "min-w-[264px] max-w-[320px] rounded-xl border-zinc-200 bg-white p-1 shadow-2xl backdrop-blur-sm",
        /* The hover effort submenu is positioned outside the list box, so
           clipping must be disabled while it is open. Radix's Viewport sets
           `overflow: hidden auto` INLINE, so the important modifier is
           required to beat it. */
        effortOpen &&
          "overflow-visible [&_[data-radix-select-viewport]]:overflow-visible!",
        className,
      )}
      {...props}
    >
      {children ?? (
        <div
          className="w-full"
          onMouseEnter={cancelEffortClose}
          onMouseLeave={scheduleEffortClose}
        >
          {visibleModels.map((model) => (
            <ModelSelectorItem
              key={model.id}
              model={model}
              {...(model.disabled ? { disabled: true } : undefined)}
            />
          ))}

          {/* Claude-style "More models" expander */}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll?.(true)}
              data-slot="model-selector-more"
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] font-medium text-zinc-900 outline-none transition-colors duration-100 hover:bg-zinc-100 focus-visible:bg-zinc-100"
            >
              <span>
                {t("modelSelector.moreModels", { defaultValue: "More models" })}
              </span>
              <ChevronDownIcon className="size-3.5 text-zinc-500" />
            </button>
          )}

          {showEffort && <EffortSection />}
        </div>
      )}
    </SelectContent>
  );
}

/**
 * Claude-style "Effort" footer row + hover submenu.
 * Per-model: shows only the effort levels the selected model supports
 * (from ModelOption.efforts). Models without efforts render nothing.
 * Opens on hover (no click needed); selecting a level is fully functional —
 * reported upward via onEffortChange.
 */
function EffortSection() {
  const { t } = useTranslation();
  const {
    efforts = [],
    effort,
    defaultEffort,
    setEffort,
    thinking,
    setThinking,
    effortOpen,
    setEffortOpen,
  } = useModelSelectorContext();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = effortOpen ?? false;
  const setOpen = setEffortOpen ?? (() => {});

  // Hover the row → the submenu opens after a short delay (Claude-style).
  // Closing is handled at the menu level (ModelSelectorContent), so the
  // pointer can travel between the row, the list, and the submenu freely.
  const handleEnter = () => {
    if (!supported) return;
    if (openTimer.current) clearTimeout(openTimer.current);
    if (!open) {
      openTimer.current = setTimeout(() => setOpen(true), 120);
    }
  };

  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  const supported = efforts.length > 0;

  return (
    <div data-slot="model-selector-effort-section">
      <div aria-hidden="true" className="mx-1 my-1 h-px bg-zinc-200" />
      <button
        type="button"
        onClick={() => {
          if (supported) setOpen(!open);
        }}
        onMouseEnter={handleEnter}
        disabled={!supported}
        data-slot="model-selector-effort"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors duration-100 focus-visible:bg-zinc-100",
          supported
            ? "hover:bg-zinc-100"
            : "cursor-not-allowed opacity-40",
        )}
      >
        <span className="font-medium text-zinc-900">
          {t("modelSelector.effort", { defaultValue: "Effort" })}
        </span>
        <span className="flex items-center gap-1 text-xs text-zinc-500">
          {supported ? (effort ?? defaultEffort) : "—"}
          <ChevronRightIcon className="size-3.5 text-zinc-500 rtl:rotate-180" />
        </span>
      </button>

      {/* Rendered inside the menu DOM (not a portal) so clicks register with
          Radix and the submenu never dismisses its own parent. Anchored to
          the menu's top edge (the viewport is position:relative), extending
          outward to the side — Claude-style. */}
      {open && (
        <div
          data-slot="model-selector-effort-panel"
          className="absolute top-0 start-full z-10 ms-1 w-60 rounded-xl border border-zinc-200 bg-white p-1 shadow-2xl"
        >
          <p className="px-2.5 py-1.5 text-[11px] leading-snug text-zinc-500">
            {t("modelSelector.effortHint", {
              defaultValue:
                "Higher effort means more thorough responses, but takes longer.",
            })}
          </p>
          {efforts.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                setEffort?.(opt);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] text-zinc-900 outline-none transition-colors duration-100 hover:bg-zinc-100 focus-visible:bg-zinc-100"
            >
              <span className="flex items-center gap-1.5">
                {opt}
                {opt === defaultEffort && (
                  <span className="rounded border border-zinc-200 px-1 py-px text-[9px] leading-none text-zinc-500">
                    {t("modelSelector.effortDefault", {
                      defaultValue: "Default",
                    })}
                  </span>
                )}
              </span>
              {effort === opt && (
                <CheckIcon className="size-3.5 text-zinc-600" />
              )}
            </button>
          ))}
          <div aria-hidden="true" className="mx-1 my-1 h-px bg-zinc-200" />
          <div className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-tight text-zinc-900">
                {t("modelSelector.thinking", { defaultValue: "Thinking" })}
              </span>
              <span className="block text-[11px] leading-snug text-zinc-500">
                {t("modelSelector.thinkingHint", {
                  defaultValue: "Can think for more complex tasks",
                })}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={thinking ?? true}
              onClick={() => setThinking?.(!(thinking ?? true))}
              className={cn(
                "relative h-4.5 w-8 shrink-0 rounded-full transition-colors duration-200",
                (thinking ?? true) ? "bg-blue-500" : "bg-zinc-300",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all duration-200",
                  (thinking ?? true) ? "left-[16px]" : "left-0.5",
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type ModelSelectorItemProps = Omit<
  ComponentPropsWithoutRef<typeof SelectItem>,
  "value" | "children"
> & {
  model: ModelOption;
};

function ModelSelectorItem({
  model,
  className,
  ...props
}: ModelSelectorItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="model-selector-item"
      value={model.id}
      textValue={model.name}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pr-7 pl-2.5 text-[13px] outline-none transition-colors duration-100",
        "text-zinc-900 hover:bg-zinc-100 hover:text-zinc-900",
        "focus:bg-zinc-100 focus:text-zinc-900",
        "data-[state=checked]:text-zinc-900",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2.5 flex size-3.5 items-center justify-center text-zinc-600">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium leading-tight">
            {model.name}
          </span>
          {model.description && (
            <span className="truncate text-[11px] leading-snug text-zinc-500">
              {model.description}
            </span>
          )}
        </span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export type ModelSelectorProps = Omit<ModelSelectorRootProps, "children"> & {
    contentClassName?: string;
    variant?: string;
    size?: "default" | "sm";
    /** Show only the first N models, with a "More models" expander (Claude-style). */
    featuredCount?: number;
    /** Show the Effort submenu + Thinking toggle footer. */
    showEffort?: boolean;
    /**
     * Called whenever the active effort for the selected model changes
     * (and on mount / model switch). Receives the UI label ("Low"…"Max"),
     * or undefined when the model has no effort support.
     */
    onEffortChange?: (effort: string | undefined) => void;
  };

const ModelSelectorImpl = ({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  defaultValue,
  models,
  variant,
  size,
  contentClassName,
  featuredCount,
  showEffort = false,
  onEffortChange,
  ...forwardedProps
}: ModelSelectorProps) => {
  // Accepted for API compatibility; no visual variant is applied today.
  void variant;
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(
    () => defaultValue ?? models[0]?.id ?? "",
  );
  const [showAll, setShowAll] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  const [effortByModel, setEffortByModel] =
    useState<EffortRecord>(loadStoredEfforts);
  const [thinking, setThinkingState] = useState<boolean>(loadStoredThinking);

  const value = isControlled ? controlledValue : internalValue;
  const onValueChange = controlledOnValueChange ?? setInternalValue;

  // Per-model effort: only the levels the selected model supports, falling
  // back to the model's default level when nothing stored (or stale).
  const selectedModel = models.find((m) => m.id === value);
  const efforts = selectedModel?.efforts ?? [];
  const defaultEffort =
    efforts.length > 0 ? defaultEffortFor(efforts) : undefined;
  const storedEffort = value != null ? effortByModel[value] : undefined;
  const effort =
    efforts.length > 0
      ? storedEffort && efforts.includes(storedEffort)
        ? storedEffort
        : defaultEffort
      : undefined;

  const setEffort = (next: string) => {
    if (value == null) return;
    setEffortByModel((prev) => {
      const nextRecord = { ...prev, [value]: next };
      try {
        localStorage.setItem(EFFORTS_STORAGE_KEY, JSON.stringify(nextRecord));
      } catch {
        /* storage unavailable */
      }
      return nextRecord;
    });
  };

  const setThinking = (next: boolean) => {
    setThinkingState(next);
    try {
      localStorage.setItem(THINKING_STORAGE_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  };

  // Report the active effort upward (wire mapping is the parent's job).
  const effortKey = efforts.join("|");
  useEffect(() => {
    onEffortChange?.(efforts.length > 0 ? effort : undefined);
  }, [effort, effortKey]);

  useAssistantContext({
    getContext: () =>
      `modelName: ${value}` +
      (showEffort ? `, effort: ${effort ?? "n/a"}, thinking: ${thinking}` : ""),
  });

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setEffortOpen(false);
      setShowAll(false);
    }
    forwardedProps.onOpenChange?.(open);
  };

  return (
    <ModelSelectorContext.Provider
      value={{
        models,
        value,
        featuredCount,
        showAll,
        setShowAll,
        showEffort,
        efforts,
        effort,
        setEffort,
        defaultEffort,
        thinking,
        setThinking,
        effortOpen,
        setEffortOpen,
      }}
    >
      <ModelSelectorRoot
        models={models}
        value={value}
        onValueChange={onValueChange}
        {...forwardedProps}
        onOpenChange={handleOpenChange}
      >
        <ModelSelectorTrigger size={size} />
        <ModelSelectorContent className={contentClassName} />
      </ModelSelectorRoot>
    </ModelSelectorContext.Provider>
  );
};

type ModelSelectorComponent = typeof ModelSelectorImpl & {
  displayName?: string;
  Root: typeof ModelSelectorRoot;
  Trigger: typeof ModelSelectorTrigger;
  Content: typeof ModelSelectorContent;
  Item: typeof ModelSelectorItem;
  Value: typeof ModelSelectorValue;
};

const ModelSelector = memo(
  ModelSelectorImpl,
) as unknown as ModelSelectorComponent;

ModelSelector.displayName = "ModelSelector";
ModelSelector.Root = ModelSelectorRoot;
ModelSelector.Trigger = ModelSelectorTrigger;
ModelSelector.Content = ModelSelectorContent;
ModelSelector.Item = ModelSelectorItem;
ModelSelector.Value = ModelSelectorValue;

export {
  ModelSelector,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorValue,
};
