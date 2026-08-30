import type { Json } from "@valbuild/core";
import type { z } from "zod";
import type { AuthorId } from "../ValOps";

/**
 * The public surface of Val's server-side tool registry.
 *
 * Types only, deliberately: this file is the contract that the MCP hosts, the
 * CLI's stdio transport and the tools themselves are all written against, and
 * keeping it free of implementation means those can be built in any order
 * without one of them owning the shape.
 *
 * The design this implements is `docs/plans/mcp.md`, Part A. Two constraints
 * from it are load-bearing and easy to break by accident:
 *
 * 1. **Nothing here may import an MCP SDK.** That is what lets hosts other
 *    than the template consume these tools, and it is not hypothetical
 *    hygiene — the TypeScript SDK reorganised itself at v2.0.0, and a registry
 *    coupled to it would have moved with it.
 * 2. **The result type is deliberately not MCP's `CallToolResult`.** Each host
 *    adapts {@link ValToolResult} at its own edge, which is also where an
 *    error becomes an in-band `isError` result the model can recover from
 *    rather than a transport failure.
 */

/** Why a tool call failed, in a form a host can map onto its own errors. */
export type ValToolErrorCode =
  /** No tool of that name is registered. */
  | "unknown-tool"
  /** The arguments did not satisfy the tool's `inputSchema`. */
  | "invalid-args"
  /** The path, module or key the arguments name does not exist. */
  | "not-found"
  /** The caller is not allowed to do this — wrong credential, or none. */
  | "forbidden"
  /**
   * The write was rejected because applying it would leave content invalid.
   * Nothing was stored. See `docs/plans/mcp.md` Part C on speculative
   * validation.
   */
  | "validation-failed"
  /**
   * Another writer moved the patch chain first. Callers may re-derive the
   * parent ref and retry once; the registry does that itself before
   * surfacing this.
   */
  | "conflict"
  /** The tool exists but is not available in this mode (e.g. fs vs http). */
  | "unsupported"
  /** Anything else, including an upstream failure. */
  | "internal";

export type ValToolDefinition = {
  name: string;
  title?: string;
  description: string;
  /** zod v4 — a Standard Schema, which is what the MCP SDKs consume. */
  inputSchema: z.ZodType;
  /**
   * MCP tool annotations. Hints, not enforcement: a host may show them to a
   * user or use them to decide what to auto-approve, so they have to be
   * honest about what the tool does.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
};

/** The same definition with `inputSchema` as JSON Schema, for hosts that want the wire shape. */
export type ValToolDefinitionJson = Omit<ValToolDefinition, "inputSchema"> & {
  inputSchema: Json;
};

/**
 * Who is calling, established once per request by the host.
 *
 * The credential travels with the identity on purpose. In proxy mode the
 * caller's own personal access token is what authenticates every downstream
 * call, so the backend rather than the app decides who the caller is — see
 * `docs/plans/mcp.md` D.2, and D.6 for why the app must not instead assert an
 * identity under its own API key.
 *
 * `null` means local fs mode, where there is no credential to hold and patches
 * are written with no author, exactly as the Studio does locally (D.1).
 */
export type ValToolContext = {
  auth: {
    /**
     * The caller's PAT. Never log this, never put it in a URL, and never let
     * it reach a tool result.
     */
    pat: string;
    /** Resolved from the PAT by the host, not taken from a request header. */
    authorId: AuthorId;
  } | null;
  /** Groups a run of related edits, when the host has such a notion. */
  sessionId: string | null;
};

export type ValToolResult =
  | { status: "ok"; data: Json }
  | { status: "error"; code: ValToolErrorCode; message: string };

export type ValTools = {
  list(): ValToolDefinition[];
  listJsonSchema(): ValToolDefinitionJson[];
  call(
    name: string,
    args: unknown,
    ctx: ValToolContext,
  ): Promise<ValToolResult>;
  dispose(): Promise<void>;
};
