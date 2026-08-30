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
  const ops = createValOps(valModules, options);
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
