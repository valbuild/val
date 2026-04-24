import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AIChatHandle } from "../components/AIChat";
import {
  type AITool,
  useCurrentProfile,
  useProfilesByAuthorId,
  useSyncEngine,
  useAIContext,
} from "../components/ValProvider";
import type { AISession, AIServerMessage } from "./useAIWebSocket";
import { useAISearch } from "./useAISearch";
import { useAIValidation } from "./useAIValidation";
import type {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { getSourcePathFromRoute } from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import { useNavigation } from "../components/ValRouter";
import { getNavPathFromAll } from "../components/getNavPath";
import { useRoutesOf } from "../components/useRoutesOf";
import { filterBlockingValidationErrors } from "./resolveValidationErrors";

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
    "Search content — accepts a query and returns matching content items. Returns { results, total } where total is the number of matches found. Use offset to page through results if total exceeds the returned results count.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" },
      limit: {
        type: "number",
        description: "Max results to return (default 50)",
      },
      offset: {
        type: "number",
        description: "Number of results to skip for pagination (default 0)",
      },
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
const NAVIGATE_TO_TOOL: AITool = {
  name: "navigate_to",
  description:
    "Navigate the user's view to a specific location in the content tree. " +
    "Use ONLY when the user explicitly asks to be shown or navigated to something, " +
    "or immediately after creating/modifying content when navigating there is clearly the expected next step. " +
    "Do NOT call this tool during normal information gathering." +
    "AVOIDING USING THIS TOOL IF USER IS NOT ON A BROWSER PATHNAME THAT STARTS WITH /val",
  parameters: {
    type: "object",
    properties: {
      source_path: {
        type: "string",
        description:
          "The SourcePath to navigate to. " +
          "Format: '/path/to/file.val.ts' for a module root, or '/path/to/file.val.ts?p=key.\"subkey\"' for a specific field. " +
          'String keys in the ModulePath are JSON-quoted (e.g. "title"), array indices are plain numbers (e.g. 0).',
      },
    },
    required: ["source_path"],
  },
};
const GET_CURRENT_CONTEXT_TOOL: AITool = {
  name: "get_current_context",
  description:
    "Get the current context: logged-in author, date/time, the val source path the user is viewing, and the browser pathname. " +
    "If the browser is on a page tracked by val (a Next.js app-router route), the matching source path is included.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
};
const GET_PATCHES_TOOL: AITool = {
  name: "get_patches",
  description:
    "List pending (unpublished) patches — changes that have been made but not yet published. " +
    "Returns patches sorted by date descending (newest first), paginated. " +
    "Each patch includes the module it affects, when it was made, and the author's name and email if available. " +
    "Use this to answer questions like 'what changed recently', 'who made changes', or 'what is waiting to be published'.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max patches to return (default 20)",
      },
      offset: {
        type: "number",
        description: "Number of patches to skip for pagination (default 0)",
      },
    },
    required: [],
  },
};
const GET_SOURCE_PATH_FROM_ROUTE_TOOL: AITool = {
  name: "get_source_path_from_route",
  description:
    "Given a URL pathname (e.g. '/blogs/blog-1'), find the val module and source path " +
    "that contains the content for that page. Only works for Next.js app router pages. " +
    "Returns moduleFilePath (use with get_source) and sourcePath (use with navigate_to or create_patch).",
  parameters: {
    type: "object",
    properties: {
      pathname: {
        type: "string",
        description: "The URL pathname, e.g. '/blogs/blog-1' or '/'",
      },
    },
    required: ["pathname"],
  },
};
const SET_SESSION_NAME_TOOL: AITool = {
  name: "set_session_name",
  description:
    "Give the current chat session a short, descriptive name once the topic is clear. " +
    "Call this exactly once per session, early in the conversation when the topic becomes clear. " +
    "Max 5 words, plain language (e.g. 'Update homepage hero text').",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short session name, max 60 characters",
      },
    },
    required: ["name"],
  },
};
const ALL_TOOLS: AITool[] = [
  GET_ALL_SCHEMA_TOOL,
  GET_SOURCE_TOOL,
  SEARCH_CONTENT_TOOL,
  VALIDATE_CONTENT_TOOL,
  CREATE_PATCH_TOOL,
  NAVIGATE_TO_TOOL,
  GET_CURRENT_CONTEXT_TOOL,
  GET_PATCHES_TOOL,
  GET_SOURCE_PATH_FROM_ROUTE_TOOL,
  SET_SESSION_NAME_TOOL,
];

export function useAI(chatRef: React.RefObject<AIChatHandle | null>) {
  const {
    subscribeToWsMessages,
    sendWsMessage,
    isWsConnected,
    aiGetSessions,
    aiGetSessionMessages,
    aiSetSessionName,
  } = useAIContext();
  const syncEngine = useSyncEngine();
  const aiSearch = useAISearch();
  const aiValidation = useAIValidation();
  const { navigate, currentSourcePath } = useNavigation();
  const currentProfile = useCurrentProfile();
  const profiles = useProfilesByAuthorId();
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const sessionIdRef = useRef<string>(currentSessionId);
  // Track active streaming ID — startAssistantMessage always appends a new
  // message (NOT idempotent), so we must only call it once per message ID.
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handler = (message: AIServerMessage) => {
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
        if (activeIdRef.current !== message.id) {
          chatRef.current.startAssistantMessage(message.id);
          chatRef.current.appendAssistantChunk(message.id, message.response);
        }
        chatRef.current.completeAssistantMessage(message.id);
        activeIdRef.current = null;
        setIsStreaming(false);
      } else if (message.type === "ai_tool_call") {
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
          const args = message.arguments as {
            query: string;
            limit?: number;
            offset?: number;
          };

          aiSearch
            .query(args.query, args.limit, args.offset)
            .then((searchResult) => {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: searchResult ?? { results: [], total: 0 },
              });
              chatRef.current?.completeToolCall(message.id, message.toolCallId);
            })
            .catch((err) => {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: false, error: String(err) },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
            });
        } else if (message.name === "validate_content") {
          const errors = aiValidation.getErrors();
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: errors,
          });
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
                    "File/image patches require dedicated tools (not yet implemented).",
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
            if (moduleSchema.type === "image" || moduleSchema.type === "file") {
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
            const validationResult = syncEngine.validatePatchResult(
              moduleFilePath,
              patch,
            );
            if (validationResult && "status" in validationResult) {
              console.error("Patch status not valid", validationResult);
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: false, error: validationResult.message },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
              return;
            }
            if (validationResult !== false) {
              const blockingErrors = filterBlockingValidationErrors(
                validationResult,
                syncEngine.getAllSchemasSnapshot(),
                syncEngine.getAllSourcesSnapshot(),
              );
              if (Object.keys(blockingErrors).length > 0) {
                console.error("Patch validation failed", blockingErrors);
                sendWsMessage({
                  type: "ai_tool_result",
                  toolCallId: message.toolCallId,
                  result: {
                    success: false,
                    error: `Patch produces validation errors: ${JSON.stringify(blockingErrors)}`,
                  },
                  isError: true,
                });
                chatRef.current?.errorToolCall(message.id, message.toolCallId);
                return;
              }
            }
            const patchId = syncEngine.createPatchId();
            const res = await syncEngine.addPatchAwaitable(
              moduleFilePath,
              moduleSchema.type,
              patch,
              patchId,
              sessionIdRef.current,
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
        } else if (message.name === "navigate_to") {
          const args = message.arguments as { source_path: string };
          const sourcePath = args.source_path as SourcePath;
          const allSources = syncEngine.getAllSourcesSnapshot() as Record<
            ModuleFilePath,
            Source
          >;
          const schemas = syncEngine.getAllSchemasSnapshot();
          const navPath = getNavPathFromAll(sourcePath, allSources, schemas);
          if (navPath === null) {
            sendWsMessage({
              type: "ai_tool_result",
              toolCallId: message.toolCallId,
              result: {
                success: false,
                error: `Invalid source path: '${args.source_path}'. Could not resolve navigation path.`,
              },
              isError: true,
            });
            chatRef.current?.errorToolCall(message.id, message.toolCallId);
          } else {
            navigate(navPath as SourcePath);
            sendWsMessage({
              type: "ai_tool_result",
              toolCallId: message.toolCallId,
              result: { success: true },
            });
            chatRef.current?.completeToolCall(message.id, message.toolCallId);
          }
        } else if (message.name === "get_current_context") {
          const schemas = syncEngine.getAllSchemasSnapshot();
          const browserPathname = window.location.pathname;
          const routeSourcePath = getSourcePathFromRoute(
            browserPathname,
            (schemas ?? {}) as Record<ModuleFilePath, SerializedSchema>,
          );
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: {
              author: currentProfile
                ? {
                    fullName: currentProfile.fullName,
                    email: currentProfile.email,
                    avatar: currentProfile.avatar,
                  }
                : null,
              dateTime: new Date().toISOString(),
              valSourcePath: currentSourcePath,
              browserPathname,
              ...(routeSourcePath ? { routeSourcePath } : {}),
            },
          });
          chatRef.current?.completeToolCall(message.id, message.toolCallId);
        } else if (message.name === "get_source_path_from_route") {
          const pathname = (message.arguments as { pathname?: string })
            .pathname;
          if (!pathname) {
            sendWsMessage({
              type: "ai_tool_result",
              toolCallId: message.toolCallId,
              result: {
                success: false,
                error: "Missing required parameter: pathname",
              },
              isError: true,
            });
            chatRef.current?.errorToolCall(message.id, message.toolCallId);
          } else {
            const schemas = syncEngine.getAllSchemasSnapshot();
            const found = getSourcePathFromRoute(
              pathname,
              (schemas ?? {}) as Record<ModuleFilePath, SerializedSchema>,
            );
            if (found) {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: true, ...found },
              });
              chatRef.current?.completeToolCall(message.id, message.toolCallId);
            } else {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: {
                  success: false,
                  error: `No next-app-router page found for pathname "${pathname}".`,
                },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
            }
          }
        } else if (message.name === "get_patches") {
          const args = message.arguments as {
            limit?: number;
            offset?: number;
          };
          const limit = args.limit ?? 20;
          const offset = args.offset ?? 0;
          const allPatches = syncEngine.getAllPatchesSnapshot() ?? {};
          const patches = Object.entries(allPatches)
            .filter(([, data]) => data !== undefined)
            .map(([patchId, data]) => {
              const profile = data!.authorId ? profiles[data!.authorId] : null;
              return {
                patchId,
                moduleFilePath: data!.moduleFilePath,
                createdAt: data!.createdAt,
                isPending: data!.isPending,
                author: profile
                  ? { fullName: profile.fullName, email: profile.email }
                  : null,
              };
            })
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            );
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: {
              patches: patches.slice(offset, offset + limit),
              total: patches.length,
            },
          });
          chatRef.current?.completeToolCall(message.id, message.toolCallId);
        } else if (message.name === "set_session_name") {
          const args = message.arguments as { name: string };
          const name = String(args.name ?? "").slice(0, 60);
          aiSetSessionName(sessionIdRef.current, name)
            .then(() => {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === sessionIdRef.current ? { ...s, name } : s,
                ),
              );
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: true },
              });
              chatRef.current?.completeToolCall(message.id, message.toolCallId);
            })
            .catch((err) => {
              sendWsMessage({
                type: "ai_tool_result",
                toolCallId: message.toolCallId,
                result: { success: false, error: String(err) },
                isError: true,
              });
              chatRef.current?.errorToolCall(message.id, message.toolCallId);
            });
        } else {
          console.error("Received unknown tool call in useAI", message.name);
          sendWsMessage({
            type: "ai_tool_result",
            toolCallId: message.toolCallId,
            result: { success: false, error: `Unknown tool: ${message.name}` },
            isError: true,
          });
        }
      } else if (message.type === "ai_error") {
        console.error("Received AI error message", message);
        if (!chatRef.current) return;
        if (activeIdRef.current !== message.id) {
          chatRef.current.startAssistantMessage(message.id);
        }
        chatRef.current.errorAssistantMessage(
          message.id,
          message.message,
          message.code,
        );
        activeIdRef.current = null;
        setIsStreaming(false);
      } else if (message.type === "ai_agent_handoff") {
        // TODO: show this in the UI in some way to indicate that the AI has handed off to a human agent:
        console.log(
          "AI agent handoff message received - agents are working",
          message,
        );
      } else {
        const _exhaustiveCheck: never = message;
        console.error(
          "Received unknown message type in useAI",
          _exhaustiveCheck,
        );
      }
    };

    return subscribeToWsMessages(handler);
  }, [
    subscribeToWsMessages,
    sendWsMessage,
    syncEngine,
    aiSearch,
    aiValidation,
    chatRef,
    navigate,
    currentProfile,
    currentSourcePath,
    profiles,
  ]);

  const sendMessage = useCallback(
    (text: string): boolean => {
      console.log("Sending AI message in useAI", text);

      return sendWsMessage({
        type: "ai_prompt",
        message: text,
        sessionId: sessionIdRef.current,
        id: crypto.randomUUID(),
        agents: [
          {
            id: "default",
            model: "openai-gpt-5.1",
            systemPrompt: `You are a helpful assistant embedded in Val, a content management system. You help non-technical content editors read, understand, and update their content.

## Who you are talking to
Users are content editors — they are NOT developers. Never use technical terms like "patch", "JSON", "schema", "module", or "RFC 6902". Explain everything in plain language. Refer to content files by their friendly name or path (e.g. "Blog Posts").

## Understanding where user is
If the get_current_context pathname starts with /val, the user is in the Val Studio. 

## Tools
Always call get_all_schema first unless the question clearly does not require it. Then:
- get_source: read the current content of a module before making changes.
- search_content: find content by keyword across all modules.
- validate_content: check for errors — call this after every change.
- create_patch: change text, numbers, dates, booleans, and lists. Do NOT use for images, files, or rich text.
- get_patches: list pending (unpublished) changes sorted by date. Use this to answer questions like "what changed recently?", "who made changes?", or "what's waiting to be published?". Returns author name and email when available. A pending change is a change that has not been successfully synced - there might be an error preventing it from syncing, or it might still be syncing. Always check the result of create_patch calls to confirm whether a change was successful or if there were errors.
- navigate_to: move the user's view to a specific location. Use ONLY when the user asks to be shown something, or right after creating/modifying content. Never call it during information gathering. If not the user is most likely looking at their live application. When they are NOT in Val Studio (when get_current_context.pathname does not start with /val), DO NOT USE the navigate_to tool, unless user asks explicitly OR if they want to change the change arrays or records. When NOT in Val Studio always ask before using navigate_to. When they ARE in Val Studio, you can use navigate_to to guide them to the relevant content.
- get_current_context: understand who the user is, what time it is, and where they are in the content tree and the site. Use this to inform your responses and actions. If the user is on a Next.js app-router page, the matching source path will be included in the context.
- set_session_name: give the current chat session a short, descriptive name once the topic is clear. Call this at least once per session, early in the conversation. Max 5 words, plain language (e.g. 'Update homepage hero text'). If there is a title or a topic use it directly.
- get_source_path_from_route: given a URL path like '/blogs/blog-1', find which Next.js page module it belongs to and return the source path. Use this when the user mentions a specific page URL or route.

## navigate_to: how to build a source path
A source path is a module file path optionally followed by ?p= and a dot-separated field path. String keys are JSON-quoted, array indices are plain numbers.
Example: /content/authors.val.ts?p="jane" navigates to the "jane" entry in the authors module.
Example: /content/posts.val.ts?p=0."title" navigates to the title of the first post.
When the user wants to see something inside a module, navigate directly to the relevant field.
Never tell the user to navigate manually — offer to navigate for them instead. After navigating, do not repeat what you already described.

## Understanding content types
- object: a group of fields
- record: a collection of items with the same shape (e.g. blog posts, products)
  - router: next-app-router — pages in a Next.js site, shown under "Pages" in the left menu
  - router: external-url-router — external links, shown under "External Sites" in the left menu
  - mediaType: "image" or "file" — a media gallery grouped by directory
- array: an ordered list of items
- string / number / boolean / date: plain values
- richtext: array of block nodes as JSON
  - block tags: p, h1-h6, ul, ol — each has a children array
  - list structure: ul/ol > {tag:"li", children:[{tag:"p",...}]}
  - inline nodes (appear inside block children): span, a, img, br
    - span: {tag:"span", styles:["bold"|"italic"|"line-through"], children:["text"]}
    - a: {tag:"a", href:"...", children:[...]}
    - img: {tag:"img", src:{...}} — cannot be added via assistant (no file system access)
    - br: {tag:"br"}
  - example: [{tag:"p",children:["Hello ",{tag:"span",styles:["bold"],children:["World"]}]}]
  - richtext schema has options, which tells you which type of tags you can use. Example: if options do not have block.ul: true, then ul is not allowed. The schema.options type is like this: style: Partial<{bold: boolean;italic: boolean;lineThrough: boolean;}>;block: Partial<{h1: boolean;h2: boolean;h3: boolean;h4: boolean;h5: boolean;h6: boolean;ul: boolean;ol: boolean;}>;inline: Partial<{a: boolean | SerializedRouteSchema | SerializedStringSchema;img: boolean | SerializedImageSchema;}>;
- image / file: cannot be changed through this assistant (no file system access). If the user needs to add one, navigate to the matching media gallery.
- union: a value that must match exactly one of several allowed shapes. Two kinds:
  - string union: key is a literal schema, all items are literals. The value is one fixed string chosen from a set (e.g. "draft", "published", "archived"). Patch by replacing the string with one of the allowed values.
  - tagged union (object union): key is a plain string (the discriminant field name), all items are objects. The active variant is identified by the literal value at that key field (e.g. { type: "image", url: "..." } vs { type: "video", src: "..." }). When patching, you must keep the discriminant key consistent with the rest of the object's fields for the chosen variant.

## When you cannot make a change
Never ask the user to apply changes themselves. Instead:
- For images, files, or rich text: navigate to the relevant location and explain what to do there.
- For errors you cannot fix: explain clearly and ask the user for clarification.
- If there is a validation error after a change, try to fix it.


## When user asks to create something they usually want you to create patches
THIS IS IMPORTANT: If it is not possible to create something (for example: user wants a blog article but there are no blog pages), asks for clarification.
Do not describe what you will do unless you do it for clarification — just do it and navigate the user to it (if they are not at the relevant location already). After creating something new (a new page), always navigate the user to it.

## Style
- Be concise and friendly.
- Confirm changes in plain language after every successful update.
- If something goes wrong, explain what happened and what to do next.`,
            tools: ALL_TOOLS,
          },
        ],
      });
    },
    [sendWsMessage],
  );

  const newSession = useCallback(() => {
    const id = crypto.randomUUID();
    sessionIdRef.current = id;
    setCurrentSessionId(id);
    chatRef.current?.clearMessages();
  }, [chatRef]);

  const getSessions = useCallback(
    async (opts?: {
      limit?: number;
      cursor?: { updatedAt: string; id: string };
    }): Promise<AISession[]> => {
      const res = await aiGetSessions(opts);
      setSessions(res.sessions);
      return res.sessions;
    },
    [aiGetSessions],
  );

  const setSessionName = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      await aiSetSessionName(sessionId, name);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, name } : s)),
      );
    },
    [aiSetSessionName],
  );

  const loadSession = useCallback(
    async (sessionId: string): Promise<void> => {
      sessionIdRef.current = sessionId;
      setCurrentSessionId(sessionId);
      chatRef.current?.clearMessages();
      try {
        const res = await aiGetSessionMessages(sessionId);
        const messages = res.messages
          ?.filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, i) => ({
            id: `history-${sessionId}-${i}`,
            role: m.role as "user" | "assistant",
            content: m.content,
            status: "complete" as const,
          }));
        chatRef.current?.loadMessages(messages);
      } catch (err) {
        console.error("Failed to load session messages:", err);
      }
    },
    [chatRef, aiGetSessionMessages],
  );

  return {
    sendMessage,
    isStreaming,
    isConnected: isWsConnected,
    newSession,
    sessions,
    currentSessionId,
    getSessions,
    setSessionName,
    loadSession,
  };
}
