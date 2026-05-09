import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ValClient } from "@valbuild/shared/internal";

// --- Shared types (must match server-side definitions) ---

export const AIModel = z.enum(["openai-gpt-5.1"]);
export type AIModel = z.infer<typeof AIModel>;

export const AITool = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
});

export type AITool = z.infer<typeof AITool>;

export const AIAgentDefinition = z.object({
  id: z.string(),
  systemPrompt: z.string(),
  model: AIModel,
  tools: z.array(AITool).optional(),
  description: z.string().optional(),
});

export type AIAgentDefinition = z.infer<typeof AIAgentDefinition>;

// --- Server → Client message types ---

export const AIToolCallMessage = z.object({
  type: z.literal("ai_tool_call"),
  id: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  arguments: z.unknown(),
});
export type AIToolCallMessage = z.infer<typeof AIToolCallMessage>;

export const AIErrorCode = z.enum([
  "max_iterations_reached",
  "token_limit_reached",
  "authentication_required",
  "session_not_found",
  "internal_error",
]);
export type AIErrorCode = z.infer<typeof AIErrorCode>;

export const AIErrorMessage = z.object({
  type: z.literal("ai_error"),
  id: z.string(),
  code: AIErrorCode,
  message: z.string(),
});
export type AIErrorMessage = z.infer<typeof AIErrorMessage>;

export const AIResponseMessage = z.object({
  type: z.literal("ai_response"),
  id: z.string(),
  sessionId: z.string(),
  response: z.string(),
  metadata: z
    .object({
      model: z.string().optional(),
      tokensUsed: z.number().optional(),
    })
    .optional(),
});
export type AIResponseMessage = z.infer<typeof AIResponseMessage>;

export const AIStreamingMessage = z.object({
  type: z.literal("ai_streaming"),
  id: z.string(),
  chunk: z.string(),
});
export type AIStreamingMessage = z.infer<typeof AIStreamingMessage>;

export const AIAgentHandoffMessage = z.object({
  type: z.literal("ai_agent_handoff"),
  id: z.string(),
  sessionId: z.string(),
  fromAgent: z.string(),
  toAgent: z.string(),
  reason: z.string().optional(),
});
export type AIAgentHandoffMessage = z.infer<typeof AIAgentHandoffMessage>;

export const AIServerMessage = z.discriminatedUnion("type", [
  AIResponseMessage,
  AIStreamingMessage,
  AIToolCallMessage,
  AIErrorMessage,
  AIAgentHandoffMessage,
]);

export type AIServerMessage = z.infer<typeof AIServerMessage>;

// --- Client → Server message types ---

export const AIMessageContentBlock = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_key"), key: z.string() }),
]);
export type AIMessageContentBlock = z.infer<typeof AIMessageContentBlock>;

export const AIPromptMessage = z.object({
  type: z.literal("ai_prompt"),
  id: z.string(),
  sessionId: z.uuid().optional(),
  message: z.union([z.string(), z.array(AIMessageContentBlock)]),
  context: z.string().optional(),
  maxIterations: z.number().int().min(1).max(200).optional(),
  agents: z.array(AIAgentDefinition).min(1),
});
export type AIPromptMessage = z.infer<typeof AIPromptMessage>;

export const AIToolResultMessage = z.object({
  type: z.literal("ai_tool_result"),
  toolCallId: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional(),
});
export type AIToolResultMessage = z.infer<typeof AIToolResultMessage>;

export const AIGetSessionsMessage = z.object({
  type: z.literal("ai_get_sessions"),
  id: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z
    .object({
      updatedAt: z.string(),
      id: z.string().uuid(),
    })
    .optional(),
});
export type AIGetSessionsMessage = z.infer<typeof AIGetSessionsMessage>;

export const AISetSessionNameMessage = z.object({
  type: z.literal("ai_set_session_name"),
  id: z.string(),
  sessionId: z.string().uuid(),
  name: z.string(),
});
export type AISetSessionNameMessage = z.infer<typeof AISetSessionNameMessage>;

export const AIGetSessionsWithMessagesMessage = z.object({
  type: z.literal("ai_get_sessions_with_messages"),
  id: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z
    .object({
      updatedAt: z.string(),
      id: z.string().uuid(),
    })
    .optional(),
});
export type AIGetSessionsWithMessagesMessage = z.infer<
  typeof AIGetSessionsWithMessagesMessage
>;

export type AIClientMessage = AIPromptMessage | AIToolResultMessage;

export type AIMessageHandler = (message: AIServerMessage) => void;

// --- Session type (used by useAI) ---

export type AISession = {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

const RECENT_SESSION_MS = 24 * 60 * 60 * 1000;

/** Returns the session if it was updated within the last 24 hours, otherwise null. */
export function getRecentSession(sessions: AISession[]): AISession | null {
  const session = sessions[0];
  if (!session) return null;
  return Date.now() - new Date(session.updatedAt).getTime() < RECENT_SESSION_MS
    ? session
    : null;
}

// --- Hook ---

const RECONNECT_DELAY = 3000;

export function useAIWebSocket(
  enabled: boolean,
  client: ValClient,
): {
  subscribeToMessages: (handler: AIMessageHandler) => () => void;
  send: (message: AIClientMessage) => boolean;
  isConnected: boolean;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const handlersRef = useRef<Set<AIMessageHandler>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const clientRef = useRef(client);
  clientRef.current = client;

  const connect = useCallback(async () => {
    if (!enabledRef.current) return;

    try {
      const res = await clientRef.current("/ai/initialize", "POST", {});

      if (res.status !== 200) {
        console.warn(
          "AI WebSocket initialize failed:",
          res.status,
          res.json.message,
        );
        scheduleReconnect();
        return;
      }

      const ws = new WebSocket(
        res.json.wsUrl + "?nonce=" + encodeURIComponent(res.json.nonce),
      );

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const json = JSON.parse(event.data);
          const parsed = AIServerMessage.safeParse(json);
          if (!parsed.success) {
            console.error(
              "Could not parse AI WebSocket message",
              parsed.error,
              "Original message:",
              json,
            );
            return;
          }
          for (const handler of handlersRef.current) {
            handler(parsed.data);
          }
        } catch (e) {
          console.error("Error processing AI WebSocket message", e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        console.warn("AI WebSocket error");
        ws.close();
      };

      wsRef.current = ws;
    } catch (e) {
      console.warn("AI WebSocket connect error", e);
      scheduleReconnect();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (enabledRef.current) {
        connect();
      }
    }, RECONNECT_DELAY);
  }, [connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);

  const subscribeToMessages = useCallback(
    (handler: AIMessageHandler): (() => void) => {
      handlersRef.current.add(handler);
      return () => {
        handlersRef.current.delete(handler);
      };
    },
    [],
  );

  const send = useCallback((message: AIClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.warn("AI WebSocket not open, cannot send");
    return false;
  }, []);

  return { subscribeToMessages, send, isConnected };
}
