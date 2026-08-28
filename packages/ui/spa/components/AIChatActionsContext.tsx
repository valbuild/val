import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { SourcePath } from "@valbuild/core";
import type { ChatEditorRef } from "./AIChatEditor";

export interface AIChatActions {
  /**
   * Whether the project has the assistant configured at all.
   *
   * Config only — see `ValProvider`. A project without it has no assistant, so
   * the studio hides every way into one rather than offering a panel that can
   * only report that there is nothing behind it.
   */
  isAIChatEnabled: boolean;
  /**
   * Whether a field can be mentioned in the assistant right now.
   *
   * Stricter than `isAIChatEnabled`, and both halves have bitten: a configured
   * assistant is still offline while the socket is connecting — and stays
   * offline if it never connects — and a layout can offer no live chat at all,
   * in which case `setOpenAIChatImpl` was never called and a mention has
   * nowhere to land. Either way the button would open nothing and drop the
   * field into nothing, with silence as the only feedback.
   *
   * `isAIChatEnabled` is the flag for the panel itself, which is where the
   * connection error and its retry are shown.
   */
  canMentionField: boolean;
  openAIChat(): void;
  setOpenAIChatImpl(fn: (() => void) | null): void;
  chatEditorRef: RefObject<ChatEditorRef | null>;
  /**
   * Mention a field in the assistant, opening it if it is not already there.
   *
   * Here rather than at the call site because of the gap between those two: the
   * shell renders the assistant panel on demand, so `openAIChat()` returns with
   * the editor not yet mounted and an insert straight after it lands on a ref
   * that is still null — the panel opens and the field is silently missing. A
   * mention made in that window is queued and replayed by
   * {@link AIChatActions.flushPendingFieldRefs} when the editor arrives.
   */
  insertFieldRef(path: SourcePath): void;
  /**
   * The chat editor is mounted; deliver anything queued for it.
   *
   * Called by whatever surface owns the editor, in an effect. Safe to call
   * whenever — an empty queue is a no-op — which is what lets the surface call
   * it on every mount rather than having to know whether one is waiting.
   */
  flushPendingFieldRefs(): void;
}

const AIChatActionsContext = createContext<AIChatActions>({
  isAIChatEnabled: false,
  canMentionField: false,
  openAIChat: () => {},
  setOpenAIChatImpl: () => {},
  chatEditorRef: { current: null },
  insertFieldRef: () => {},
  flushPendingFieldRefs: () => {},
});

export function AIChatActionsProvider({
  isAIChatEnabled,
  isAIChatOnline,
  children,
}: {
  isAIChatEnabled: boolean;
  /** Whether the assistant's socket is connected. See `canMentionField`. */
  isAIChatOnline: boolean;
  children: ReactNode;
}) {
  const openImplRef = useRef<(() => void) | null>(null);
  const chatEditorRef = useRef<ChatEditorRef | null>(null);
  /**
   * The same registration as `openImplRef`, as state.
   *
   * A ref cannot be read to decide whether to render the mention button — that
   * is what `canMentionField` needs — so whether there is a chat to mention
   * into has to be a value the fields re-render on.
   */
  const [hasChatSurface, setHasChatSurface] = useState(false);

  /** Mentions made before the editor existed, oldest first. See `insertFieldRef`. */
  const pendingFieldRefs = useRef<SourcePath[]>([]);

  const openAIChat = useCallback(() => {
    openImplRef.current?.();
  }, []);

  const setOpenAIChatImpl = useCallback((fn: (() => void) | null) => {
    openImplRef.current = fn;
    setHasChatSurface(fn !== null);
  }, []);

  const insertFieldRef = useCallback(
    (path: SourcePath) => {
      openAIChat();
      const editor = chatEditorRef.current;
      if (editor === null) {
        pendingFieldRefs.current.push(path);
        return;
      }
      editor.insertFieldRef(path);
    },
    [openAIChat],
  );

  const flushPendingFieldRefs = useCallback(() => {
    const editor = chatEditorRef.current;
    if (editor === null || pendingFieldRefs.current.length === 0) return;
    const queued = pendingFieldRefs.current;
    pendingFieldRefs.current = [];
    for (const path of queued) {
      editor.insertFieldRef(path);
    }
  }, []);

  const value = useMemo<AIChatActions>(
    () => ({
      isAIChatEnabled,
      canMentionField: isAIChatEnabled && isAIChatOnline && hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
      chatEditorRef,
      insertFieldRef,
      flushPendingFieldRefs,
    }),
    [
      isAIChatEnabled,
      isAIChatOnline,
      hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
      insertFieldRef,
      flushPendingFieldRefs,
    ],
  );

  return (
    <AIChatActionsContext.Provider value={value}>
      {children}
    </AIChatActionsContext.Provider>
  );
}

export function useAIChatActions(): AIChatActions {
  return useContext(AIChatActionsContext);
}

export function useInsertFieldRef() {
  return useAIChatActions().insertFieldRef;
}
