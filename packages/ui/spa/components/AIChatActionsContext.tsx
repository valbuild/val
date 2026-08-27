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
}

const AIChatActionsContext = createContext<AIChatActions>({
  isAIChatEnabled: false,
  canMentionField: false,
  openAIChat: () => {},
  setOpenAIChatImpl: () => {},
  chatEditorRef: { current: null },
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

  const openAIChat = useCallback(() => {
    openImplRef.current?.();
  }, []);

  const setOpenAIChatImpl = useCallback((fn: (() => void) | null) => {
    openImplRef.current = fn;
    setHasChatSurface(fn !== null);
  }, []);

  const value = useMemo<AIChatActions>(
    () => ({
      isAIChatEnabled,
      canMentionField: isAIChatEnabled && isAIChatOnline && hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
      chatEditorRef,
    }),
    [
      isAIChatEnabled,
      isAIChatOnline,
      hasChatSurface,
      openAIChat,
      setOpenAIChatImpl,
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
  const { chatEditorRef, openAIChat } = useAIChatActions();
  return useCallback(
    (path: SourcePath) => {
      openAIChat();
      chatEditorRef.current?.insertFieldRef(path);
    },
    [chatEditorRef, openAIChat],
  );
}
