import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AIChatHandle } from "../components/AIChat";
import { useWsMessages } from "../components/ValProvider";
import type { WsExtendedMessage } from "./useStatus";

export function useAI(chatRef: React.RefObject<AIChatHandle | null>) {
  const { subscribeToWsMessages, sendWsMessage } = useWsMessages();
  const [isStreaming, setIsStreaming] = useState(false);
  // Track active streaming ID — startAssistantMessage always appends a new
  // message (NOT idempotent), so we must only call it once per message ID.
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (message: WsExtendedMessage) => {
      console.log("Received WebSocket message in useAI", message);
      if (message.type === "ai_streaming") {
        if (!chatRef.current) return;
        if (activeIdRef.current !== message.id) {
          activeIdRef.current = message.id;
          chatRef.current.startAssistantMessage(message.id);
          setIsStreaming(true);
        }
        chatRef.current.appendAssistantChunk(message.id, message.chunk);
      } else if (message.type === "ai_response") {
        if (!chatRef.current) return;
        chatRef.current.startAssistantMessage(message.id);
        chatRef.current.appendAssistantChunk(message.id, message.response);
        chatRef.current.completeAssistantMessage(message.id);
        activeIdRef.current = null;
        setIsStreaming(false);
      }
      // mcp_tool_request: ignored here, handled by a future useMCP hook
    };

    return subscribeToWsMessages(handler);
  }, [subscribeToWsMessages, chatRef]);

  const sendMessage = useCallback(
    (text: string) => {
      console.log("Sending AI message in useAI", text);
      sendWsMessage({
        type: "ai_prompt",
        message: text,
        id: crypto.randomUUID(),
      });
    },
    [sendWsMessage],
  );

  return { sendMessage, isStreaming };
}
