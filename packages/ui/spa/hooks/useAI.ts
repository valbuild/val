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
import type { ModuleFilePath } from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";

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
const GET_SOURCE_TOOL: AITool = {
  name: "get_source",
  description:
    "Get the current source content of a Val module by its file path. " +
    "The 'module_file_path' must exactly match one of the keys returned by get_all_schema.",
  parameters: {
    type: "object",
    properties: {
      module_file_path: {
        type: "string",
        description:
          "The Val module file path, e.g. '/content/homepage.val.ts'. Can be obtained from the keys of get_all_schema.",
      },
    },
    required: ["module_file_path"],
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
  description: `Create a Val patch — applies RFC 6902 JSON Patch operations to a Val module. 
    Use ONLY for string, number, boolean, null, object, array, and date (ISO 8601) fields. 
    DO NOT use for image, file, or richtext fields — those require dedicated tools. 
    Supported ops: 'replace', 'add', 'remove'. 
    The 'path' must be a JSON Pointer AS AN ARRAY: (e.g. ['title'], ['items', '0', 'name']).
    NOTE: If it is a record, the key might be a url ('/foo/bar'), in this case it should be represented as ['foo/bar'] in the path array, not ['foo', 'bar'].

    The 'module_file_path' must exactly match a key returned by get_all_schema. 
    After applying a patch, always call validate_content to check for validation errors and fix them if found.
    If you cannot, ask user for clarification instead of reverting content.

    
    Example 'patch' value that changes the title of a record item called '/blog/blog-10' to 'Test':
    {"patch":[{"op":"replace","path":["/blogs/blog-10","title"],"value":"Test"}]},
    `,
  parameters: {
    type: "object",
    properties: {
      module_file_path: {
        type: "string",
        description:
          "The Val module file path, e.g. '/content/homepage.val.ts'",
      },
      patch: {
        type: "array",
        description:
          "Array of a format that is RFC 6902 patch operations, except that path is array of strings. Each item: { op, path, value? }",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["replace", "add", "remove"] },
            path: { type: "array", items: { type: "string" } },
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
  GET_SOURCE_TOOL,
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
  const sessionIdRef = useRef(crypto.randomUUID());
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
        // Ensure assistant message is active so tool indicators can be shown
        if (chatRef.current) {
          if (activeIdRef.current !== message.id) {
            activeIdRef.current = message.id;
            chatRef.current.startAssistantMessage(message.id);
            setIsStreaming(true);
          }
          chatRef.current.addToolCall(
            message.id,
            message.toolCallId,
            message.name,
          );
        }
        if (message.name === "get_all_schema") {
          const schemas = syncEngine.getAllSchemasSnapshot();
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: schemas ?? {},
          });
          chatRef.current?.completeToolCall(message.id, message.toolCallId);
        } else if (message.name === "get_source") {
          const args = message.arguments as { module_file_path: string };
          const moduleFilePath = args.module_file_path as ModuleFilePath;
          const snapshot = syncEngine.getSourceSnapshot(moduleFilePath);
          if (snapshot.status === "success") {
            sendWsMessage({
              type: "ai_tool_result",
              toolCallId: message.toolCallId,
              result: { success: true, source: snapshot.data },
            });
            chatRef.current?.completeToolCall(message.id, message.toolCallId);
          } else {
            sendWsMessage({
              type: "ai_tool_result",
              toolCallId: message.toolCallId,
              result: {
                success: false,
                error:
                  snapshot.status === "no-schemas"
                    ? "Schemas not loaded yet. Try again shortly."
                    : `Module not found: '${moduleFilePath}'. Use get_all_schema to see available modules.`,
              },
              isError: true,
            });
            chatRef.current?.errorToolCall(message.id, message.toolCallId);
          }
        } else if (message.name === "search_content") {
          const args = message.arguments as { query: string };

          aiSearch
            .query(args.query, message.toolCallId)
            .then(() => {
              chatRef.current?.completeToolCall(message.id, message.toolCallId);
            })
            .catch(() => {
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
            });
        } else if (message.name === "validate_content") {
          aiValidation.getErrors(message.toolCallId);
          chatRef.current?.completeToolCall(message.id, message.toolCallId);
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
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
              return;
            }
            const parseResult = Patch.safeParse(args.patch);
            if (!parseResult.success) {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error: `Invalid patch operations. Zod error: ${JSON.stringify(parseResult.error)}`,
                },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
              return;
            }
            const patch = parseResult.data;
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
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
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
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
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
              chatRef.current?.completeToolCall(message.id, message.toolCallId);
            } else {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: false, error: res.message },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
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
  }, [
    subscribeToWsMessages,
    sendWsMessage,
    syncEngine,
    aiSearch,
    aiValidation,
    chatRef,
  ]);

  const sendMessage = useCallback(
    (text: string): boolean => {
      console.log("Sending AI message in useAI", text);

      return sendWsMessage({
        type: "ai_prompt",
        message: text,
        sessionId: sessionIdRef.current,
        context: `You are a helpful assistant embedded in Val, a content management system. You help non-technical content editors read, understand, and update their content.

## Who you are talking to
Users are content editors — they are NOT developers. Never use technical terms like "patch", "JSON", "schema", "module", "source path", or "RFC 6902". Explain everything in plain language. If you must refer to a content file, use its friendly name or path (e.g. "the Blog Posts content").

## How to use your tools efficiently
Always start by calling get_all_schema to understand what content exists. Then:
- Use get_source to read the current content of a specific file before making changes.
- Use search_content to find content by keyword across all files.
- Use validate_content to check if content is valid — do this after every change.
- Use create_patch to make changes to text, numbers, dates, true/false values, and lists. Do NOT use it for images, files, or rich text — those cannot be changed through this assistant.

Call get_all_schema first, before anything else, unless the user's question clearly does not require it.

## Understanding the schema
Val content is organized into modules (files ending in .val.ts). Each module has a schema that describes its structure:
- s.object / object: a group of fields (like a form with multiple fields)
- s.record / record: a collection of items, each with the same shape (like a list of blog posts)
  - s.record may have a router property that is next-app-router : a collection of pages in a Next.js website — these appear under "Pages" in the left navigation menu
  - s.record may have a router property that is external-url-router : a collection of external links — these appear under "External Sites" in the left navigation menu
- Other modules (not routers) appear under "Explorer" in the left navigation menu
- s.string: plain text
- s.number: a number
- s.boolean: yes/no toggle
- s.date: a date (stored as ISO 8601, e.g. "2024-01-15")
- s.array: a list of items
- s.richtext: formatted text (bold, italic, headings etc.) — cannot be changed through this assistant
- s.image / s.file: an image or file — cannot be changed through this assistant

## When you cannot make a change
If you are unable to change something (e.g. images, files, rich text, or you get an error), guide the user to make the change themselves using the left navigation menu:
- If the content is a router with next-app-router (router ID: "next-app-router"): tell the user to find it under "Pages" in the left menu
- If the content is a router with external-url-router (router ID: "external-url-router"): tell the user to find it under "External Sites" in the left menu
- For all other content: tell the user to find it under "Explorer" in the left menu
Never ask the user to write or apply a patch themselves — they cannot do that.

## Style
- Be concise and friendly.
- Confirm what changed in plain language after every successful update.
- If something goes wrong, explain clearly what happened and what the user should do next.`,
        id: crypto.randomUUID(),
        tools: ALL_TOOLS,
      });
    },
    [sendWsMessage],
  );

  const newSession = useCallback(() => {
    sessionIdRef.current = crypto.randomUUID();
    chatRef.current?.clearMessages();
  }, [chatRef]);

  return { sendMessage, isStreaming, isConnected: isWsConnected, newSession };
}
