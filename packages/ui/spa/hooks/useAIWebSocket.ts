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
  // Optional server-side timeout for waiting on the matching ai_tool_result.
  // Omitted → server default (30s). A number → wait that many ms. null → wait indefinitely.
  timeoutMs: z.union([z.number().nonnegative(), z.null()]).optional(),
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
  // The content server grew these with BYOK. The enum is strict, so a code
  // missing here fails the whole discriminated union and the error is dropped
  // rather than shown — keep it in step with AIErrorCode on the server.
  "byok_invalid_key",
  "provider_not_configured",
  "model_refusal",
]);
export type AIErrorCode = z.infer<typeof AIErrorCode>;

/** Something the client can offer after an error, e.g. a link to set up a key. */
export const AIErrorAction = z.object({
  type: z.literal("setup_byok"),
  label: z.string(),
  url: z.string(),
});
export type AIErrorAction = z.infer<typeof AIErrorAction>;

export const AIErrorMessage = z.object({
  type: z.literal("ai_error"),
  id: z.string(),
  code: AIErrorCode,
  message: z.string(),
  resetDate: z.string().optional(),
  action: AIErrorAction.optional(),
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

/**
 * A prompt the user stopped. Not an error: the client should settle rather than
 * report a failure, keeping whatever text arrived first.
 */
export const AICancelledMessage = z.object({
  type: z.literal("ai_cancelled"),
  id: z.string(),
  sessionId: z.string().optional(),
  partialResponse: z.string().optional(),
});
export type AICancelledMessage = z.infer<typeof AICancelledMessage>;

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
  AICancelledMessage,
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

/** Stop an in-flight prompt. `id` is the id of the `ai_prompt` to stop. */
export const AICancelMessage = z.object({
  type: z.literal("ai_cancel"),
  id: z.string(),
});
export type AICancelMessage = z.infer<typeof AICancelMessage>;

export type AIClientMessage =
  | AIPromptMessage
  | AIToolResultMessage
  | AICancelMessage;

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
/**
 * How many times a failing connection is tried before it gives up.
 *
 * It used to be unbounded: every failed `/ai/initialize` and every closed
 * socket scheduled another attempt three seconds later, for as long as the tab
 * was open. Where the assistant is enabled but cannot start — no API key on the
 * server, the AI service down — that is a request every three seconds and a
 * `console.warn` beside it, forever, and the panel still shows a composer that
 * looks like it works.
 *
 * Attempts reset the moment a socket opens, so a connection that drops after
 * working gets the full allowance again rather than inheriting an old count.
 */
const MAX_CONNECT_ATTEMPTS = 5;

export function useAIWebSocket(
  enabled: boolean,
  client: ValClient,
): {
  subscribeToMessages: (handler: AIMessageHandler) => () => void;
  send: (message: AIClientMessage) => boolean;
  isConnected: boolean;
  authError: boolean;
  /**
   * Why the assistant is unavailable, once there is nothing left to try.
   *
   * `null` while it is connecting or retrying: a message that comes and goes
   * with a retry loop is noise, and the panel has nothing useful to say until
   * the studio has actually stopped.
   */
  connectionError: string | null;
  /** Try to connect again, from the first attempt. */
  retryConnection: () => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const handlersRef = useRef<Set<AIMessageHandler>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const clientRef = useRef(client);
  clientRef.current = client;

  /**
   * One attempt failed. Try again, or stop and say so.
   *
   * Both outcomes are here rather than at the call sites so there is one place
   * that decides when to stop — the initialize call, the socket closing and a
   * thrown request all fail differently and all have to stop in the same way.
   */
  const failed = useCallback((message: string) => {
    if (attemptsRef.current >= MAX_CONNECT_ATTEMPTS) {
      // Warned once, where there is nothing left to try. It used to warn on
      // every attempt, which is what made this the loudest thing in the console.
      console.warn("Giving up on the AI connection:", message);
      setConnectionError(message);
      return;
    }
    scheduleReconnectRef.current();
  }, []);

  const connect = useCallback(async () => {
    if (!enabledRef.current) return;
    attemptsRef.current += 1;

    try {
      const res = await clientRef.current("/ai/initialize", "POST", {});

      if (res.status === 401) {
        // Terminal on its own: another attempt with the same credentials gets
        // the same answer, and `authError` is what the UI shows for it.
        setAuthError(true);
        return;
      }

      if (res.status !== 200) {
        failed(
          typeof res.json.message === "string"
            ? res.json.message
            : `The assistant could not be started (${res.status})`,
        );
        return;
      }
      setAuthError(false);

      const ws = new WebSocket(
        res.json.wsUrl + "?nonce=" + encodeURIComponent(res.json.nonce),
      );

      ws.onopen = () => {
        // A working connection resets the allowance: a drop after an hour of
        // use is not the fifth failure of a connection that never worked.
        attemptsRef.current = 0;
        setConnectionError(null);
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
          failed("Lost the connection to the assistant");
        }
      };

      ws.onerror = () => {
        console.warn("AI WebSocket error");
        ws.close();
      };

      wsRef.current = ws;
    } catch (e) {
      failed(e instanceof Error ? e.message : "Could not reach the assistant");
    }
  }, [failed]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (enabledRef.current) {
        connect();
      }
    }, RECONNECT_DELAY);
  }, [connect]);
  // Through a ref because `failed` is defined above it: the two call each other,
  // and a ref is the one direction that does not need the other to exist yet.
  const scheduleReconnectRef = useRef(scheduleReconnect);
  scheduleReconnectRef.current = scheduleReconnect;

  /** Start over, because someone asked. */
  const retryConnection = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    attemptsRef.current = 0;
    setConnectionError(null);
    setAuthError(false);
    connect();
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

  return {
    subscribeToMessages,
    send,
    isConnected,
    authError,
    connectionError,
    retryConnection,
  };
}
