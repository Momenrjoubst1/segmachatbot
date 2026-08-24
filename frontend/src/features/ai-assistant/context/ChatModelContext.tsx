import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import {
  DEFAULT_MODEL_ID,
  isAvailableModelId,
  type KnownModelId,
} from "../model-catalog";

/**
 * Per-thread UI state for the chat model picker.
 *
 * The model id lives in TWO places:
 *   - React state, so the UI re-renders when the user picks a new model.
 *   - A ref mirrored off that state, so non-React code paths (the `customFetch`
 *     closure inside `useRuntime`) can read the *current* selection
 *     synchronously without re-creating the fetch callback on every change.
 *
 * Why both? `useChatRuntime` is keyed by `chatKey` (one runtime per thread
 * switch), but the user expects the chosen model to persist across new chats.
 * A ref is the cleanest way to share a value between a hook closure and a
 * long-lived child without forcing re-mounts.
 *
 * Persistence: localStorage so a hard refresh keeps the previous choice.
 */
interface ChatModelContextValue {
  model: KnownModelId;
  setModel: (id: KnownModelId) => void;
  /** Stable ref consumers can read inside non-React callbacks. */
  modelRef: MutableRefObject<KnownModelId>;
  /**
   * Active reasoning effort for the current model (wire value: low | medium |
   * high | xhigh | max), or undefined when the model has no effort support.
   * Mirrored as a ref for the same reason as modelRef — read synchronously
   * inside the customFetch closure at send time.
   */
  effortRef: MutableRefObject<string | undefined>;
  setEffort: (effort: string | undefined) => void;
}

const ChatModelContext = createContext<ChatModelContextValue | null>(null);

const STORAGE_KEY = "sigma:chat-model";

function readStoredModel(): KnownModelId {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isAvailableModelId(raw)) return raw;
  } catch {
    // localStorage may throw in private mode / sandboxed iframes.
  }
  return DEFAULT_MODEL_ID;
}

function writeStoredModel(id: KnownModelId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore — best-effort persistence
  }
}

export function ChatModelProvider({ children }: { children: ReactNode }) {
  const [model, setModelState] = useState<KnownModelId>(readStoredModel);

  // Ref mirrors the state so non-React readers (customFetch) see the latest
  // value without subscribing. We update it inside an effect so the ref is
  // always written after the corresponding render commits.
  const modelRef = useRef<KnownModelId>(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const setModel = useCallback((id: KnownModelId) => {
    if (!isAvailableModelId(id)) return;
    setModelState(id);
    modelRef.current = id;
    writeStoredModel(id);
  }, []);

  // Effort is owned by the model selector UI (which persists per-model
  // choices); the context only mirrors the active wire value for the
  // non-React send path.
  const effortRef = useRef<string | undefined>(undefined);
  const setEffort = useCallback((effort: string | undefined) => {
    effortRef.current = effort;
  }, []);

  const value = useMemo<ChatModelContextValue>(
    () => ({ model, setModel, modelRef, effortRef, setEffort }),
    [model, setModel, effortRef, setEffort],
  );

  return (
    <ChatModelContext.Provider value={value}>
      {children}
    </ChatModelContext.Provider>
  );
}

/** Read/write the chat model from a component. */
export function useChatModel(): ChatModelContextValue {
  const ctx = useContext(ChatModelContext);
  if (!ctx) {
    throw new Error("useChatModel must be used within <ChatModelProvider>");
  }
  return ctx;
}

/**
 * Read-only hook that returns the live model ref. Use this from non-React
 * callbacks (e.g. fetch wrappers) where you cannot safely call `useChatModel`
 * because the value may be stale across renders.
 */
export function useChatModelRef(): MutableRefObject<KnownModelId> {
  const { modelRef } = useChatModel();
  return modelRef;
}

/**
 * Read-only hook that returns the live effort ref (wire value or undefined).
 * Same contract as useChatModelRef — for non-React send-path readers.
 */
export function useChatEffortRef(): MutableRefObject<string | undefined> {
  const { effortRef } = useChatModel();
  return effortRef;
}
