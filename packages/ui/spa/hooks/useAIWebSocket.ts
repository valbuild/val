import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ValClient } from "@valbuild/shared/internal";
import {
  resolvePreferredModel,
  writePreferredModel,
} from "./aiModelPreference";

// --- Shared types (must match server-side definitions) ---

/**
 * The AI providers the content server has an implementation for.
 *
 * The one thing the server is authoritative about. Which models exist is this
 * client's business — see `VAL_AI_MODELS`.
 */
export const AIProviderId = z.enum(["openai", "anthropic"]);
export type AIProviderId = z.infer<typeof AIProviderId>;

/**
 * A model, as this client names it: a provider plus that provider's own model
 * id, which the server passes through to the SDK untouched.
 */
export const AIModel = z.object({
  provider: AIProviderId,
  model: z.string().min(1),
});
export type AIModel = z.infer<typeof AIModel>;

export type AIModelInfo = {
  ref: AIModel;
  /** What to call it in the UI. */
  label: string;
};

/**
 * The models the Studio offers, best first within each provider.
 *
 * This is the catalog, and it lives here rather than on the content server so
 * that offering a newly released model is a change to the editor and nothing
 * else. The server only checks that it implements the provider and that the
 * caller has a key for it.
 *
 * Order is the fallback order: with bring-your-own-key an org may have a key
 * for one provider and not another, so the first entry whose provider is
 * reachable is the one used.
 */
export const VAL_AI_MODELS: AIModelInfo[] = [
  {
    ref: { provider: "openai", model: "gpt-5.1" },
    label: "GPT-5.1",
  },
  {
    ref: { provider: "anthropic", model: "claude-sonnet-5" },
    label: "Claude Sonnet 5",
  },
  {
    ref: { provider: "anthropic", model: "claude-opus-5" },
    label: "Claude Opus 5",
  },
  {
    ref: { provider: "anthropic", model: "claude-haiku-4-5" },
    label: "Claude Haiku 4.5",
  },
];

/**
 * The first model in the catalog whose provider the server says is reachable.
 *
 * Null once the server has answered and none of them are — which with
 * bring-your-own-key means no key is configured for any provider we can drive,
 * and callers treat that as "AI is off" rather than as an error.
 */
export function pickAvailableModel(
  serverProviders: string[] | undefined,
): AIModel | null {
  if (serverProviders === undefined) {
    // An older content server does not report them, and had a shared OpenAI
    // key with one model — so the original default is the right guess.
    return VAL_AI_MODELS[0].ref;
  }
  const reachable = new Set(serverProviders);
  return (
    VAL_AI_MODELS.find((info) => reachable.has(info.ref.provider))?.ref ?? null
  );
}

/**
 * The server's model list, as `AIModelInfo`.
 *
 * Entries for a provider this version does not implement are dropped: the
 * content server may know a provider before the Studio does, and offering one
 * we cannot drive would be a picker entry that always fails.
 */
function toModelInfos(
  reported: { provider: string; model: string; label: string }[] | undefined,
): AIModelInfo[] {
  if (!reported) {
    return [];
  }
  return reported.flatMap((entry) => {
    const provider = AIProviderId.safeParse(entry.provider);
    if (!provider.success) {
      return [];
    }
    return [
      {
        ref: { provider: provider.data, model: entry.model },
        label: entry.label || entry.model,
      },
    ];
  });
}

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
  // The content server grew these with BYOK.
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
  /**
   * Unknown codes fall back rather than failing the parse.
   *
   * This enum is strict and sits inside a discriminated union, so a code the
   * server has but this client does not used to drop the entire message: the
   * user saw the turn hang instead of the reason it stopped, and the only
   * trace was a console log. The server is free to add codes without waiting
   * for a Studio release; the message still arrives, with its text intact.
   */
  code: AIErrorCode.catch("internal_error"),
  message: z.string(),
  resetDate: z.string().optional(),
  action: AIErrorAction.optional(),
  /**
   * The provider's own account of the failure — status, error type, request id,
   * verbatim message — for a developer who wants to work around the problem
   * rather than guess at it. Shown behind a disclosure, never in the message.
   */
  details: z.string().optional(),
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

export const AISessionUnhiddenMessage = z.object({
  type: z.literal("ai_session_unhidden"),
  id: z.string(),
  sessionId: z.string(),
});
export type AISessionUnhiddenMessage = z.infer<typeof AISessionUnhiddenMessage>;

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
  AISessionUnhiddenMessage,
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
  /**
   * Create the session outside the chat list. For work the user did not start a
   * conversation for — the publish flow's commit summary — so it does not put a
   * session in the sidebar per publish. Honoured only when the session is
   * created; `ai_unhide_session` reveals it later.
   */
  hidden: z.boolean().optional(),
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

/** Bring a hidden session into the chat list, so the user can open it. */
export const AIUnhideSessionMessage = z.object({
  type: z.literal("ai_unhide_session"),
  id: z.string(),
  sessionId: z.string(),
});
export type AIUnhideSessionMessage = z.infer<typeof AIUnhideSessionMessage>;

export type AIClientMessage =
  | AIPromptMessage
  | AIToolResultMessage
  | AICancelMessage
  | AIUnhideSessionMessage;

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
  /**
   * The model to use, picked from what the server said is available.
   *
   * Null once the server has answered and nothing it offers is a model this
   * client knows — which with bring-your-own-key means no key is configured
   * for any provider the Studio can drive.
   */
  availableModel: AIModel | null;
  /**
   * Every model the project's keys can actually reach, as the providers report
   * them. Empty when the content server does not report them (or could not
   * reach a provider), in which case the built-in catalog is what is offered.
   */
  availableModels: AIModelInfo[];
  /** The model the editor picked, or the best default until they pick one. */
  selectedModel: AIModel | null;
  selectModel: (model: AIModel) => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [availableModel, setAvailableModel] = useState<AIModel | null>(null);
  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<AIModel | null>(null);
  const selectModel = useCallback((model: AIModel) => {
    setSelectedModel(model);
    writePreferredModel(model);
  }, []);
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
      const fallback = pickAvailableModel(res.json.providers);
      setAvailableModel(fallback);
      // What the providers actually offer, when the server could ask them. The
      // built-in catalog is the fallback, filtered to reachable providers, so
      // an older content server or a provider that would not answer still
      // leaves a usable picker rather than an empty one.
      const reported = toModelInfos(res.json.models);
      const offered =
        reported.length > 0
          ? reported
          : VAL_AI_MODELS.filter((info) =>
              res.json.providers === undefined
                ? true
                : res.json.providers.includes(info.ref.provider),
            );
      setAvailableModels(offered);
      setSelectedModel(
        resolvePreferredModel(
          offered.map((info) => info.ref),
          fallback,
        ),
      );

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
    availableModel,
    availableModels,
    selectedModel,
    selectModel,
  };
}
