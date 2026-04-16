import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AIChatHandle } from "../components/AIChat";
import {
  AITool,
  useSyncEngine,
  useWsMessages,
} from "../components/ValProvider";
import type { WsExtendedMessage } from "./useStatus";
import { useAISearch } from "./useAISearch";
import { useAIValidation } from "./useAIValidation";

const GET_ALL_SCHEMA_TOOL: AITool = {
  name: "get_all_schema",
  description:
    "Get all val schemas — returns the complete schema definitions for all val modules",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};
const SEARCH_CONTENT_TOOL: AITool = {
  name: "search_content",
  description:
    "Search content — accepts a query and returns a list of matching content items",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
    },
    required: ["query"],
  },
};
const VALIDATE_CONTENT_TOOL: AITool = {
  name: "validate_content",
  description:
    "Get all current validation errors — returns a list of modules with their validation errors, grouped by module path",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};
const ALL_TOOLS: AITool[] = [
  GET_ALL_SCHEMA_TOOL,
  SEARCH_CONTENT_TOOL,
  VALIDATE_CONTENT_TOOL,
];

export function useAI(chatRef: React.RefObject<AIChatHandle | null>) {
  const { subscribeToWsMessages, sendWsMessage, isWsConnected } =
    useWsMessages();
  const syncEngine = useSyncEngine();
  const aiSearch = useAISearch();
  const aiValidation = useAIValidation();
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
      } else if (message.type === "ai_tool_call") {
        console.log("Received ai_tool_call message", message);
        if (message.name === "get_all_schema") {
          const schemas = syncEngine.getAllSchemasSnapshot();
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: schemas ?? {},
          });
        } else if (message.name === "search_content") {
          const args = message.arguments as { query: string };

          aiSearch.query(args.query, message.toolCallId);
        } else if (message.name === "validate_content") {
          aiValidation.getErrors(message.toolCallId);
        } else {
          const exhaustiveCheck: never = message.name;
          console.error("Received unknown tool call in useAI", exhaustiveCheck);
        }
      } else if (message.type === "error") {
        if (!chatRef.current) return;
        if (activeIdRef.current !== message.id) {
          chatRef.current.startAssistantMessage(message.id);
        }
        chatRef.current.errorAssistantMessage(message.id, message.message);
        activeIdRef.current = null;
        setIsStreaming(false);
      } else {
        console.error("Received unknown message type in useAI", message);
      }
      // mcp_tool_request: ignored here, handled by a future useMCP hook
    };

    return subscribeToWsMessages(handler);
  }, [subscribeToWsMessages, sendWsMessage, syncEngine, aiSearch, aiValidation, chatRef]);

  const sendMessage = useCallback(
    (text: string): boolean => {
      console.log("Sending AI message in useAI", text);

      return sendWsMessage({
        type: "ai_prompt",
        message: text,
        context: `You are a helpful AI assistant for a content management system called Val.
- Users are working in another code base where they have Val installed, and are using you to ask questions about their content schemas, and to get help writing content.
- Be concise, accurate, and helpful.`,
        id: crypto.randomUUID(),
        tools: ALL_TOOLS,
      });
    },
    [sendWsMessage],
  );

  return { sendMessage, isStreaming, isConnected: isWsConnected };
}
