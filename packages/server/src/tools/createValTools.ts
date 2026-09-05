import type { ValModules } from "@valbuild/core";
import { z } from "zod";
import type { ValServerConfig } from "../ValServer";
import { createValOps } from "../valServerConfig";
import type { ValOps } from "../ValOps";
import type { ValToolDeps, ValToolImpl, ValToolState } from "./defineTool";
import { readTools } from "./readTools";
import { writeTools } from "./writeTools";
import {
  VAL_SCOPE_READ,
  VAL_SCOPE_WRITE,
  type ValScope,
  type ValToolContext,
  type ValToolDefinition,
  type ValToolDefinitionJson,
  type ValToolResult,
  type ValTools,
} from "./types";

export type ValToolsOptions = ValServerConfig;

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

      const insufficient = refuseInsufficientScope(tool, ctx);
      if (insufficient) {
        return insufficient;
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
 * This is the one place authorization is decided, and in proxy mode there is
 * exactly one credential it will act on: an access token whose signature,
 * issuer, audience and expiry the host verified against the authorization
 * server's published key. Anything less is refused here rather than forwarded.
 *
 * There used to be a second route — the caller's personal access token, passed
 * through unread on the reasoning that the backend, not the app, is the
 * authority on what it may do. That was true, and it was still the wrong shape:
 * it made an unauthenticated bearer token on a deployed endpoint a supported
 * configuration, and it meant `initValMcp` had a path where an app served MCP
 * without ever being told where to authorize. A host that has not verified
 * anything now gets a refusal that names the missing `oauth` config.
 *
 * What has *not* changed is why a verified token does not become the app's own
 * API key by some other name. The app authenticates to the backend with its own
 * key here, and who did what travels as the patch's `authorId` — so the
 * profile has to be one the host checked cryptographically, never one it was
 * handed. An `authenticate()` that decided a credential's rights inside the app
 * would make every bug in it full access to every project that key can reach.
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
        //
        // A verified access token is not something the caller chose to send: it
        // only exists because this app advertised an authorization server, so
        // the developer seeing this did not do anything wrong — a config file
        // did, and naming it is the difference between a two-minute fix and an
        // afternoon.
        return {
          status: "error",
          result: {
            status: "error",
            code: "unsupported",
            message:
              "This Val project is running in local filesystem mode, so there is nothing to authenticate against, but it is configured with an `oauth` issuer and is therefore asking clients for an access token it cannot use. Remove the `oauth` config (or `VAL_OAUTH_ISSUER` from your local `.env`) for local development.",
          },
        };
      }
      return { status: "ok", ops };
    };
  }

  /**
   * One instance for every verified caller, and that is correct rather than a
   * shortcut: this instance authenticates with the app's own API key, so there
   * is nothing per-caller in it to keep apart. Who did what travels as the
   * patch's `authorId` instead — see `writePath`.
   *
   * One instance is also all proxy mode keeps now. It could not share while a
   * personal access token reached this function: each token needed its own
   * `ValOpsHttp` to hold it, each of those cached the project's evaluated
   * modules, and the bounded cache that kept that memory in check turned an
   * eviction into a re-evaluation of every module on the next call.
   */
  let sharedOps: ValOps | null = null;

  return (ctx) => {
    if (ctx.auth?.type !== "verified-profile") {
      return {
        status: "error",
        result: {
          status: "error",
          code: "forbidden",
          message:
            "This Val project talks to the Val content backend, so every call needs an access token from the Val authorization server. If this endpoint is not asking clients to authorize, it has no `oauth` config — give `initValMcp` one, or run the project in local filesystem mode for development.",
        },
      };
    }
    if (!options.apiKey) {
      // Proxy mode is inferred from the api key being present, so this is
      // unreachable through `initHandlerOptions`. It stays because the
      // alternative to refusing is building ops with no credential at all.
      return {
        status: "error",
        result: {
          status: "error",
          code: "forbidden",
          message:
            "This Val project has no API key configured, so a verified access token cannot be exchanged for backend access.",
        },
      };
    }
    if (!sharedOps) {
      sharedOps = createValOps(valModules, options);
    }
    return { status: "ok", ops: sharedOps };
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
 *
 * Exported for `toolsFixture`, not for consumers: `tools/index.ts` re-exports by
 * name, so this stays inside the package. A test that assembled its own state
 * would be asserting against a view no real call ever sees.
 */
export async function loadState(
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

/**
 * Refuse a call the token was not granted, before anything is attempted.
 *
 * Derived from `readOnlyHint` rather than from a second list of tool names,
 * because a second list is a thing that drifts. The derivation also fails in
 * the safe direction: a tool that forgets the hint is treated as a write and
 * demands the wider scope, rather than a write slipping through as a read.
 *
 * The early return is local filesystem mode and nothing else. `auth` is null
 * there because there was no credential to carry scopes, and a project that
 * writes a developer's own working tree has no wider authority to withhold.
 * Every other caller arrives as a verified profile, carrying the scopes its
 * token was issued with.
 */
function refuseInsufficientScope(
  tool: ValToolDefinition,
  ctx: ValToolContext,
): ValToolResult | null {
  if (ctx.auth?.type !== "verified-profile") {
    return null;
  }
  // Read is needed by every call, including the writes: a tool that changes
  // content reads it first, and `ValToolAuth` says as much. Checking only the
  // wider scope would let a write-but-not-read token through here — today's
  // verifier refuses such a token before this point, but `createValTools` is
  // exported and another host may not.
  const needed: ValScope[] = tool.annotations?.readOnlyHint
    ? [VAL_SCOPE_READ]
    : [VAL_SCOPE_READ, VAL_SCOPE_WRITE];
  const granted = ctx.auth.scopes;
  const missing = needed.filter((scope) => !granted.includes(scope));
  if (missing.length === 0) {
    return null;
  }
  return {
    status: "error",
    code: "forbidden",
    message: `This access token does not have the ${missing.join(
      " and ",
    )} scope, which ${tool.name} requires. Granted: ${
      granted.length > 0 ? granted.join(" ") : "(none)"
    }.`,
  };
}
