import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { z } from "zod";
import type {
  ValOps,
  OrderedPatches,
  PatchAnalysis,
  Schemas,
  Sources,
} from "../ValOps";
import type {
  ValToolContext,
  ValToolDefinition,
  ValToolErrorCode,
  ValToolResult,
} from "./types";

/**
 * How a tool is written, and what it is handed.
 *
 * Tools are defined with {@link defineTool} so that the handler's `args` are
 * inferred from the tool's own `inputSchema`. Without that the array of tools
 * would have to be typed at its widest and every handler would start by
 * re-narrowing `unknown`, which is exactly where a tool and its schema drift
 * apart unnoticed.
 */

/** Everything a tool is allowed to reach. Deliberately narrow. */
export type ValToolDeps = {
  /**
   * The data layer for *this call*. In proxy mode it is authenticated as the
   * caller, so a tool must never reach for an ambient instance instead.
   */
  ops: ValOps;
  ctx: ValToolContext;
  /**
   * The content as the caller should see it: base sources with pending patches
   * applied, plus the schemas and the patch analysis that produced them.
   *
   * Loaded once per call and shared, because a tool that re-derived it would
   * both pay for it again and risk reading a different revision than the one it
   * validated against.
   */
  state: ValToolState;
};

export type ValToolState = {
  schemas: Schemas;
  serializedSchemas: Record<ModuleFilePath, SerializedSchema>;
  sources: Sources;
  patches: OrderedPatches;
  analysis: PatchAnalysis;
};

export type ValToolImpl = ValToolDefinition & {
  handler: (args: unknown, deps: ValToolDeps) => Promise<ValToolResult>;
};

/**
 * Declare a tool, binding its handler to its input schema.
 *
 * The handler receives already-parsed arguments: the registry validates against
 * `inputSchema` before calling, so a handler never sees input its schema would
 * have rejected.
 */
export function defineTool<S extends z.ZodType>(
  definition: Omit<ValToolDefinition, "inputSchema"> & { inputSchema: S },
  handler: (args: z.infer<S>, deps: ValToolDeps) => Promise<ValToolResult>,
): ValToolImpl {
  return {
    ...definition,
    handler: (args, deps) => handler(args as z.infer<S>, deps),
  };
}

export function ok(data: Json): ValToolResult {
  return { status: "ok", data };
}

export function err(code: ValToolErrorCode, message: string): ValToolResult {
  return { status: "error", code, message };
}
