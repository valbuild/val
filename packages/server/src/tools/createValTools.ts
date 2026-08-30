import { createHash } from "node:crypto";
import type { ValModules } from "@valbuild/core";
import { z } from "zod";
import type { ValServerConfig } from "../ValServer";
import { createValOps } from "../valServerConfig";
import type { ValOps } from "../ValOps";
import type { ValToolDeps, ValToolImpl, ValToolState } from "./defineTool";
import { readTools } from "./readTools";
import { writeTools } from "./writeTools";
import type {
  ValToolContext,
  ValToolDefinition,
  ValToolDefinitionJson,
  ValToolResult,
  ValTools,
} from "./types";

export type ValToolsOptions = ValServerConfig;

/**
 * How many callers' data layers to keep around in proxy mode.
 *
 * Each entry holds one `ValOpsHttp`, and each of those caches the project's
 * evaluated modules once `initSources` has run — so this bounds memory, not just
 * entry count. Small on purpose: the cost of a miss is re-evaluating the
 * modules on the next call, which is what happened on *every* call before this
 * cache existed.
 */
const MAX_CACHED_OPS = 8;

/**
 * Val's server-side tool registry.
 *
 * This is the piece Val did not have: the Studio's chat tools are defined *and
 * executed in the browser*, against its client stores, so nothing here could be
 * re-exposed. These tools run against {@link ValOps} instead, which is what lets
 * an MCP server — or a stdio transport, or anything else — drive Val content
 * without a browser.
 *
 * Transport-agnostic on purpose: nothing under `tools/` imports an MCP SDK. A
 * host adapts {@link ValToolResult} at its own edge.
 */
export function createValTools(
  valModules: ValModules,
  options: ValToolsOptions,
): ValTools {
  const resolveOps = createOpsResolver(valModules, options);
  const tools = [...readTools(), ...writeTools()];
  const byName = new Map<string, ValToolImpl>(
    tools.map((tool) => [tool.name, tool]),
  );

  return {
    list(): ValToolDefinition[] {
      return tools.map(({ handler: _handler, ...definition }) => definition);
    },

    listJsonSchema(): ValToolDefinitionJson[] {
      return tools.map(({ handler: _handler, inputSchema, ...rest }) => ({
        ...rest,
        // zod 4 derives this itself, so there is no JSON-Schema-to-zod
        // converter anywhere in the stack and no second description of the
        // same input to keep in step.
        inputSchema: z.toJSONSchema(inputSchema, { io: "input" }),
      }));
    },

    async call(
      name: string,
      args: unknown,
      ctx: ValToolContext,
    ): Promise<ValToolResult> {
      const tool = byName.get(name);
      if (!tool) {
        return {
          status: "error",
          code: "unknown-tool",
          message: `No tool named ${JSON.stringify(name)}. Available: ${tools
            .map((t) => t.name)
            .join(", ")}`,
        };
      }

      const parsed = tool.inputSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          status: "error",
          code: "invalid-args",
          message: describeZodError(parsed.error),
        };
      }

      const resolved = resolveOps(ctx);
      if (resolved.status === "error") {
        return resolved.result;
      }
      const ops = resolved.ops;

      try {
        const state = await loadState(ops);
        if (state.status === "error") {
          return state.result;
        }
        const deps: ValToolDeps = { ops, ctx, state: state.state };
        return await tool.handler(parsed.data, deps);
      } catch (error) {
        // A thrown error here is a bug or an unreachable backend, not something
        // the model can act on — but it still comes back in-band so the client
        // sees a tool failure rather than a dead transport.
        return {
          status: "error",
          code: "internal",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async dispose(): Promise<void> {
      // Nothing to release today: ValOps holds no handle that needs closing, and
      // the fs watcher it can start is owned by the Studio's server. Kept in the
      // contract so hosts wire up teardown now rather than when it starts to
      // matter.
    },
  };
}

/**
 * Pick the data layer for a call, which in proxy mode means picking whose
 * credential the backend will see.
 *
 * This is the one place authorization is decided, and it decides it by *not*
 * deciding: in proxy mode the caller's own personal access token goes to the
 * backend, which is the only party that can say what that token may do. The app
 * never inspects it, never caches a verdict about it, and never substitutes its
 * own API key for a missing one — see `docs/plans/mcp.md` D.2.
 *
 * The alternative shape, and the reason this function exists at all, is an
 * `authenticate()` that checks the PAT once and then acts under the app's key.
 * That reads as more secure and is strictly less so: the check happens in the
 * app, so every bug in it becomes full access to every project the app's key
 * can reach, and the backend's own permission model stops being consulted (D.6).
 */
function createOpsResolver(
  valModules: ValModules,
  options: ValToolsOptions,
): (ctx: ValToolContext) => OpsResolution {
  if (options.mode === "fs") {
    // One instance, built once: fs mode is a developer's own working tree, so
    // there is no credential to vary by and no reason to re-evaluate modules.
    const ops = createValOps(valModules, options);
    return (ctx) => {
      if (ctx.auth) {
        // Refused rather than ignored. A host that thinks it is passing a
        // credential should not silently get local filesystem access instead —
        // and the difference matters, because fs mode writes straight to disk
        // with no backend permission check at all.
        return {
          status: "error",
          result: {
            status: "error",
            code: "unsupported",
            message:
              "This Val project is running in local filesystem mode, where there is nothing to authenticate against. Do not send a credential.",
          },
        };
      }
      return { status: "ok", ops };
    };
  }

  // Keyed by a hash of the PAT, so the same caller reuses their own instance and
  // two callers can never share one. Hashing is not a security boundary — the
  // instance holds the token regardless — but it keeps credentials out of the
  // key set, which is the thing that ends up in a heap dump or an error dump.
  const byPatHash = new Map<string, ValOps>();

  return (ctx) => {
    if (!ctx.auth) {
      return {
        status: "error",
        result: {
          status: "error",
          code: "forbidden",
          message:
            "This Val project talks to the Val content backend, so every call needs the caller's own personal access token. Run `val login` to get one.",
        },
      };
    }
    const key = createHash("sha256").update(ctx.auth.pat).digest("hex");
    const cached = byPatHash.get(key);
    if (cached) {
      // Re-inserted so eviction drops the least recently used rather than the
      // oldest — a long-running caller should not be evicted by a burst of
      // one-off ones.
      byPatHash.delete(key);
      byPatHash.set(key, cached);
      return { status: "ok", ops: cached };
    }
    const ops = createValOps(valModules, options, { pat: ctx.auth.pat });
    byPatHash.set(key, ops);
    while (byPatHash.size > MAX_CACHED_OPS) {
      const oldest = byPatHash.keys().next();
      if (oldest.done) {
        break;
      }
      byPatHash.delete(oldest.value);
    }
    return { status: "ok", ops };
  };
}

type OpsResolution =
  | { status: "ok"; ops: ValOps }
  | { status: "error"; result: ValToolResult };

/**
 * The content as the caller should see it, loaded once per call.
 *
 * Pending patches are applied, because an agent looking at a project mid-edit
 * should see what the Studio would show rather than the last published state.
 *
 * Deliberately not cached across calls. In fs mode a save recomputes the base
 * sha within the same process, so a cached view would go stale silently — and
 * the cost of being wrong here is an agent writing a patch against content that
 * has already moved.
 */
async function loadState(
  ops: ValOps,
): Promise<
  | { status: "ok"; state: ValToolState }
  | { status: "error"; result: ValToolResult }
> {
  const patches = await ops.fetchPatches({ excludePatchOps: false });
  // fetchPatches resolves with its failures on the result rather than rejecting,
  // so not checking these reads as "no pending changes" — which would quietly
  // hand back published content and let a write be based on it.
  if (patches.unauthorized) {
    return {
      status: "error",
      result: {
        status: "error",
        code: "forbidden",
        message:
          "Not authorized to read this project's pending changes. Check that the credential is valid and has access.",
      },
    };
  }
  if (patches.networkError) {
    return {
      status: "error",
      result: {
        status: "error",
        code: "internal",
        message: "Could not reach the Val content backend.",
      },
    };
  }
  if (patches.error) {
    return {
      status: "error",
      result: {
        status: "error",
        code: "internal",
        message: patches.error.message,
      },
    };
  }

  const analysis = ops.analyzePatches(patches.patches);
  // getSourcesWithPatchesApplied, not getSources(analysis): the latter returns
  // only the modules that had patches, and validating that subset reports
  // spurious errors for anything that looks across modules, like keyOf or a
  // router.
  const sourcesRes = await ops.getSourcesWithPatchesApplied({
    ...analysis,
    ...patches,
  });
  const [schemas, serializedSchemas] = await Promise.all([
    ops.getSchemas(),
    ops.getSerializedSchemas(),
  ]);

  return {
    status: "ok",
    state: {
      schemas,
      serializedSchemas,
      sources: sourcesRes.sources,
      patches,
      analysis,
      // Which modules hold a pending patch that would not apply. Carried rather
      // than discarded because their `sources` silently lack that change: the
      // content here is not what publishing would produce, so a write against
      // it would be based on a state that does not exist. See
      // `unappliedPatchesFor`.
      unappliedPatches: sourcesRes.errors,
    },
  };
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
