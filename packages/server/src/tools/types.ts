import type { AuthorId } from "../ValOps";
import type { Json } from "@valbuild/core";
import type { z } from "zod";

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

/**
 * The same definition with `inputSchema` as JSON Schema, for hosts that want the
 * wire shape rather than a Standard Schema.
 *
 * Typed as whatever zod's own converter produces, so deriving it needs no cast
 * and no second hand-written description of the same input.
 */
export type ValToolDefinitionJson = Omit<ValToolDefinition, "inputSchema"> & {
  inputSchema: ReturnType<typeof z.toJSONSchema<z.ZodType>>;
};

/**
 * How the caller was established, and it is a union because there are two
 * genuinely different answers — with different consequences downstream.
 *
 * The distinction that matters is **who checked**. A PAT is forwarded to the
 * backend unchecked, because the app cannot resolve one; an access token is
 * verified by the app itself, against a public key it does not hold and
 * therefore cannot forge. The first is a credential being relayed. The second
 * is a signature that has already been checked.
 */
export type ValToolAuth =
  | {
      type: "pat";
      /**
       * The caller's PAT. Never log this, never put it in a URL, and never let
       * it reach a tool result.
       *
       * Relayed to the backend as-is: this app is not the authority on what the
       * token may do, and the backend that is decides. Nothing is derived from
       * it here — see `docs/plans/mcp.md` D.2.
       */
      pat: string;
    }
  | {
      type: "verified-profile";
      /**
       * The profile the host **verified** — the `sub` of an access token whose
       * signature, issuer, audience and expiry were all checked against the
       * authorization server's published key.
       *
       * This field is the reason this type became a union, and an earlier
       * version of this file argued no identity field should exist at all. That
       * argument was about a specific case and stated too broadly: an id the
       * host *asserts* on the strength of a credential it cannot check is an
       * unverified claim dressed as a checked one, and that is still refused —
       * it is why the `pat` variant carries no profile. An id the host
       * *verified* cryptographically is a different thing, and it is the same
       * standing the Studio has when it re-signs a session it established
       * itself.
       */
      profileId: AuthorId;
      /**
       * The token's granted scopes, as the authorization server issued them.
       *
       * Enforced here as well as by the backend, deliberately. Two checks on
       * one grant is not redundancy for its own sake: this one can refuse a
       * write before it is attempted, so a token that may only read never
       * reaches the code that builds a patch.
       */
      scopes: string[];
    };

/**
 * Who is calling, established once per request by the host.
 *
 * `null` means local fs mode, where there is no credential to hold and patches
 * are written with no author, exactly as the Studio does locally (D.1). In
 * proxy mode `null` is refused rather than falling back to the app's own API
 * key: that key can do more than any single user, and quietly substituting it
 * would turn a missing credential into full access.
 */
export type ValToolContext = {
  auth: ValToolAuth | null;
  /** Groups a run of related edits, when the host has such a notion. */
  sessionId: string | null;
};

/**
 * Brand a verified subject as an {@link AuthorId}.
 *
 * `AuthorId` is a branded string so that an id cannot be conjured from any
 * string that happens to be lying around — which is exactly the mistake this
 * type is guarding against. That makes one assertion unavoidable at the boundary
 * where a real id enters the system, so it lives here, once, with a name that
 * says what makes it legitimate: the caller has *verified* this subject, not
 * received it.
 *
 * Do not reach for this to satisfy a type. If you are holding a string you did
 * not verify, the honest value is `null`.
 */
export function authorIdFromVerifiedSubject(subject: string): AuthorId {
  return subject as AuthorId;
}

/** Read access. Every call needs it, the writes included. */
export const VAL_SCOPE_READ = "val:read";
/** Write access. Needed *in addition* by any tool not marked `readOnlyHint`. */
export const VAL_SCOPE_WRITE = "val:write";

export type ValScope = typeof VAL_SCOPE_READ | typeof VAL_SCOPE_WRITE;

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
