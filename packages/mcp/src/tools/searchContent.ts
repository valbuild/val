import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  createSearchIndex,
  indexModule,
  performSearch,
} from "@valbuild/shared/internal";
import { minimatch } from "minimatch";
import { defineTool, err, ok, type ValToolImpl } from "./defineTool";
import type { ValToolState } from "./defineTool";
import { z } from "zod";

/**
 * Full-text search across a project's content, built fresh on every call.
 *
 * No index lifecycle, which `docs/plans/mcp.md` listed as the reason this tool
 * was deferred. It turned out not to be needed, and the measurement is the
 * argument — indexing `valbuild/web`, a real production site:
 *
 * ```
 *  20 modules,   206 KB of source JSON   →  162 ms
 * 200 modules,  2.0 MB (the same, x10)   →  1.4 s
 * 1000 modules, 10 MB  (the same, x50)   →  7.9 s
 * ```
 *
 * (node 22, 4-cpu container. Searching the built index is another 0.2 ms, which
 * is why none of the numbers below are about searching.)
 *
 * Two things follow. Indexing is **linear and cheap** — a real project is a
 * sixth of a second, and the 10 s default deadline is not reached until roughly
 * 13 MB of content, which is far past any Val project anyone has. And loading
 * the modules costs *more* than indexing them (843 ms for those same 20), which
 * every tool call already pays in `loadState` — so search adds a fraction on top
 * of a cost that is already sunk, rather than being the expensive thing it looks
 * like.
 *
 * It is also the wrong comparison that matters: the alternative is `get_source`
 * on every module so the model can read them itself, which moves the whole
 * corpus through the context window. This moves a query in and a page of hits
 * back.
 */

/** Low on purpose. See the numbers above: reaching it means something is wrong. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

/** How many omitted module paths to name before summarising the rest. */
const MAX_NAMED_OMISSIONS = 20;

const ModulePatternSchema = z
  .array(z.string())
  .optional()
  .describe(
    'Module file path globs, e.g. ["/content/blogs/**"]. Matched against the whole module file path.',
  );

export function searchContentTool(): ValToolImpl {
  return defineTool(
    {
      name: "search_content",
      title: "Search content",
      description:
        "Find content by text across the project's Val modules, with unpublished changes applied. Returns the source paths of matching values, which get_source reads. Narrow with include/exclude when you know roughly where to look — that is also the fix if a search reports omitted modules.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'The text to search for. Matches are on word prefixes, so "blog" finds "blogging".',
          ),
        include: ModulePatternSchema.describe(
          'Only search these modules, e.g. ["/content/blogs/**"]. Everything else is skipped and is NOT reported as omitted — omissions mean the deadline was hit, not that you excluded something.',
        ),
        exclude: ModulePatternSchema.describe(
          "Skip these modules. Applied after include.",
        ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(20)
          .describe("Maximum number of hits to return."),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of hits to skip, for paging."),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(MAX_TIMEOUT_MS)
          .default(DEFAULT_TIMEOUT_MS)
          .describe(
            "How long to spend indexing before answering with what has been indexed so far. The default is enough for any ordinary project; a search that reports omitted modules is better narrowed with include than given longer.",
          ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, deps) => {
      if (args.query.trim() === "") {
        return err("invalid-args", "The query is empty, so nothing to search.");
      }

      const selected = selectModules(deps.state, args.include, args.exclude);
      if (selected.length === 0) {
        return err(
          "not-found",
          args.include || args.exclude
            ? "No modules matched include/exclude. get_all_schema lists the module paths."
            : "This project has no Val modules to search.",
        );
      }

      const built = buildWithDeadline(deps.state, selected, args.timeoutMs);
      const found = performSearch(
        built.index,
        args.query,
        args.limit,
        args.offset,
      );

      return ok({
        results: found.results.map((hit) => ({
          path: hit.path,
          // What the Studio would show for this hit, so an agent and an editor
          // are looking at the same thing.
          label: hit.label,
          moduleFilePath: moduleOf(hit.path),
        })),
        total: found.total,
        // What was actually searched, so `total` can be read for what it is: a
        // count over these modules, not over the project.
        searched: {
          modules: built.indexedModules,
          of: selected.length,
        },
        // Present and empty rather than absent when nothing was dropped: a
        // caller should not have to tell "no omissions" from "this tool does
        // not report them".
        omittedModules: built.omitted.slice(0, MAX_NAMED_OMISSIONS),
        omittedModuleCount: built.omitted.length,
        timedOut: built.timedOut,
        ...(built.timedOut
          ? {
              hint: `Indexing stopped after ${args.timeoutMs}ms with ${built.omitted.length} module(s) unread, so these results are partial. Search again with include set to the modules you care about, or use count_entries to see which of the omitted ones are large.`,
            }
          : {}),
      });
    },
  );
}

/**
 * Which modules this search covers.
 *
 * Sorted, and that is load bearing rather than tidiness: indexing stops at a
 * deadline, so the ORDER decides what a partial answer contains. A stable order
 * means the same call twice gives the same partial answer, and that narrowing
 * with `include` predictably reaches what was dropped. Indexing whatever
 * `Object.keys` happened to yield would make a timed-out search irreproducible.
 */
function selectModules(
  state: ValToolState,
  include: string[] | undefined,
  exclude: string[] | undefined,
): ModuleFilePath[] {
  return Object.keys(state.sources)
    .filter((moduleFilePath) => {
      if (include && !include.some((p) => minimatch(moduleFilePath, p))) {
        return false;
      }
      if (exclude && exclude.some((p) => minimatch(moduleFilePath, p))) {
        return false;
      }
      return true;
    })
    .sort()
    .map((moduleFilePath) => moduleFilePath as ModuleFilePath);
}

/**
 * Index until the work is done or the clock runs out.
 *
 * Checked BETWEEN modules, so one module is always indexed whole. That is the
 * only granularity the index has — `indexModule` is atomic, and half a module
 * in the index is a module whose absent half looks like content that does not
 * exist. It also means a single module larger than the whole deadline cannot be
 * interrupted, which the numbers say is not a real case: the largest module in
 * `valbuild/web` is 290 KB of source and indexes in well under a second.
 *
 * The first module is always indexed, deadline or not. A search that returned
 * nothing at all because the clock had already run out would be a worse answer
 * than a slow one.
 *
 * Exported for its own tests: driving the deadline through the tool would mean
 * a corpus big enough to take longer than the smallest timeout the schema
 * allows, which is a race on a fast machine and a slow suite on any machine.
 */
export function buildWithDeadline(
  state: ValToolState,
  modules: ModuleFilePath[],
  timeoutMs: number,
): {
  index: ReturnType<typeof createSearchIndex>;
  indexedModules: number;
  omitted: ModuleFilePath[];
  timedOut: boolean;
} {
  const index = createSearchIndex();
  const deadline = Date.now() + timeoutMs;
  let indexedModules = 0;

  for (let i = 0; i < modules.length; i++) {
    if (i > 0 && Date.now() >= deadline) {
      return {
        index,
        indexedModules,
        omitted: modules.slice(i),
        timedOut: true,
      };
    }
    const moduleFilePath = modules[i];
    const source: Json | undefined = state.sources[moduleFilePath];
    const schema: SerializedSchema | undefined =
      state.serializedSchemas[moduleFilePath];
    if (source === undefined || schema === undefined) {
      // A module with no schema is not searchable and is not an omission
      // either: nothing was skipped for want of time.
      continue;
    }
    indexModule(index, moduleFilePath, source, schema);
    indexedModules++;
  }

  return { index, indexedModules, omitted: [], timedOut: false };
}

function moduleOf(sourcePath: SourcePath): ModuleFilePath {
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  return moduleFilePath;
}
