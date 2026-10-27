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
  /**
   * Put a question to the assistant, opening it if it is not already there.
   *
   * For an affordance elsewhere in the Studio that stands for a request someone
   * would otherwise have had to type — "Generate from my content" on an empty
   * tone of voice is the first. It SENDS: a button that only fills the composer
   * and waits is a worse thing than the sentence it saved.
   *
   * The prompt goes in as an ordinary user message, so the conversation shows
   * what was asked and the editor can carry on from it. Same queue-and-replay
   * as {@link AIChatActions.insertFieldRef}, for the same reason and one more:
   * opening the assistant is what MOUNTS the surface that owns `sendMessage`,
   * so there is nothing to send with until the render after.
   */
  askAssistant(prompt: string): void;
  /**
   * Register how a prompt is sent. Called by the surface that owns the
   * conversation, and `null` on unmount.
   *
   * Registering also DELIVERS anything queued, which is what makes
   * {@link AIChatActions.askAssistant} work across the mount it triggers —
   * there is no separate flush to remember to call.
   */
  setAskAssistantImpl(fn: ((prompt: string) => void) | null): void;
}

const AIChatActionsContext = createContext<AIChatActions>({
  isAIChatEnabled: false,
  canMentionField: false,
  openAIChat: () => {},
  setOpenAIChatImpl: () => {},
  chatEditorRef: { current: null },
  insertFieldRef: () => {},
  flushPendingFieldRefs: () => {},
  askAssistant: () => {},
  setAskAssistantImpl: () => {},
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
  const askImplRef = useRef<((prompt: string) => void) | null>(null);
  /** Prompts asked before the surface existed, oldest first. See `askAssistant`. */
  const pendingPrompts = useRef<string[]>([]);

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

  const askAssistant = useCallback(
    (prompt: string) => {
      openAIChat();
      const ask = askImplRef.current;
      if (ask === null) {
        pendingPrompts.current.push(prompt);
        return;
      }
      ask(prompt);
    },
    [openAIChat],
  );

  const setAskAssistantImpl = useCallback(
    (fn: ((prompt: string) => void) | null) => {
      askImplRef.current = fn;
      if (fn === null || pendingPrompts.current.length === 0) {
        return;
      }
      // Drained before sending, not after: `StrictMode` registers, cleans up
      // and registers again, and a queue still holding the prompt on the second
      // pass would send it twice. Emptying it first makes the second
      // registration a no-op.
      const queued = pendingPrompts.current;
      pendingPrompts.current = [];
      for (const prompt of queued) {
        fn(prompt);
      }
    },
    [],
  );

  const value = useMemo<AIChatActions>(
    () => ({
      isAIChatEnabled,
      canMentionField: isAIChatEnabled && isAIChatOnline && hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
      chatEditorRef,
      insertFieldRef,
      flushPendingFieldRefs,
      askAssistant,
      setAskAssistantImpl,
    }),
    [
      isAIChatEnabled,
      isAIChatOnline,
      hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
      insertFieldRef,
      flushPendingFieldRefs,
      askAssistant,
      setAskAssistantImpl,
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
