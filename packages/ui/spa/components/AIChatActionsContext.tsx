import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { SourcePath } from "@valbuild/core";
import type { ChatEditorRef } from "./AIChatEditor";

export interface AIChatActions {
  isAIChatEnabled: boolean;
  openAIChat(): void;
  setOpenAIChatImpl(fn: (() => void) | null): void;
  chatEditorRef: RefObject<ChatEditorRef | null>;
}

const AIChatActionsContext = createContext<AIChatActions>({
  isAIChatEnabled: false,
  openAIChat: () => {},
  setOpenAIChatImpl: () => {},
  chatEditorRef: { current: null },
});

export function AIChatActionsProvider({
  isAIChatEnabled,
  children,
}: {
  isAIChatEnabled: boolean;
  children: ReactNode;
}) {
  const openImplRef = useRef<(() => void) | null>(null);
  const chatEditorRef = useRef<ChatEditorRef | null>(null);

  const openAIChat = useCallback(() => {
    openImplRef.current?.();
  }, []);

  const setOpenAIChatImpl = useCallback((fn: (() => void) | null) => {
    openImplRef.current = fn;
  }, []);

  const value = useMemo<AIChatActions>(
    () => ({
      isAIChatEnabled,
      openAIChat,
      setOpenAIChatImpl,
      chatEditorRef,
    }),
    [isAIChatEnabled, openAIChat, setOpenAIChatImpl],
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
