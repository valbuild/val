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
import { parsePatch } from "@valbuild/core/patch";
import type { ModuleFilePath } from "@valbuild/core";

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
const CREATE_PATCH_TOOL: AITool = {
  name: "create_patch",
  description:
    "Create a Val patch — applies RFC 6902 JSON Patch operations to a Val module. " +
    "Use ONLY for string, number, boolean, null, object, array, and date (ISO 8601) fields. " +
    "DO NOT use for image, file, or richtext fields — those require dedicated tools. " +
    "Supported ops: 'replace', 'add', 'remove'. " +
    "The 'path' must be a JSON Pointer (e.g. '/title', '/items/0/name'). " +
    "The 'module_file_path' must exactly match a key returned by get_all_schema. " +
    "After applying a patch, always call validate_content to check for validation errors and fix them if found.",
  parameters: {
    type: "object",
    properties: {
      module_file_path: {
        type: "string",
        description: "The Val module file path, e.g. '/content/homepage.val.ts'",
      },
      patch: {
        type: "array",
        description: "Array of RFC 6902 patch operations. Each item: { op, path, value? }",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["replace", "add", "remove"] },
            path: { type: "string" },
            value: {},
          },
          required: ["op", "path"],
        },
      },
    },
    required: ["module_file_path", "patch"],
  },
};
const ALL_TOOLS: AITool[] = [
  GET_ALL_SCHEMA_TOOL,
  SEARCH_CONTENT_TOOL,
  VALIDATE_CONTENT_TOOL,
  CREATE_PATCH_TOOL,
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
        } else if (message.name === "create_patch") {
          const args = message.arguments as {
            module_file_path: string;
            patch: unknown[];
          };
          (async () => {
            const hasFileOp = (args.patch ?? []).some(
              (op: unknown) =>
                typeof op === "object" &&
                op !== null &&
                (op as { op?: string }).op === "file",
            );
            if (hasFileOp) {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error:
                    "File/image/richtext patches require dedicated tools (not yet implemented).",
                },
                isError: true,
              });
              return;
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parseResult = parsePatch(args.patch as any);
            if (parseResult.kind === "err") {
              const issues = parseResult.error
                .map(
                  (issue: { path: string[]; message: string }) =>
                    `[${issue.path.join("/")}] ${issue.message}`,
                )
                .join("; ");
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error: `Invalid patch operations: ${issues}`,
                },
                isError: true,
              });
              return;
            }
            const patch = parseResult.value;
            const moduleFilePath = args.module_file_path as ModuleFilePath;
            const schemas = syncEngine.getAllSchemasSnapshot();
            const moduleSchema = schemas?.[moduleFilePath];
            if (!moduleSchema) {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error: `Module not found: '${moduleFilePath}'. Use get_all_schema to see available modules.`,
                },
                isError: true,
              });
              return;
            }
            if (
              moduleSchema.type === "image" ||
              moduleSchema.type === "file" ||
              moduleSchema.type === "richtext"
            ) {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error: `Module '${moduleFilePath}' has type '${moduleSchema.type}' which requires dedicated tools.`,
                },
                isError: true,
              });
              return;
            }
            const patchId = syncEngine.createPatchId();
            const res = await syncEngine.addPatchAwaitable(
              moduleFilePath,
              moduleSchema.type,
              patch,
              patchId,
              Date.now(),
            );
            if (res.status === "patch-synced") {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: true,
                  patchId: res.patchId,
                  message: "Patch applied successfully.",
                },
              });
            } else {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: false, error: res.message },
                isError: true,
              });
            }
          })();
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
