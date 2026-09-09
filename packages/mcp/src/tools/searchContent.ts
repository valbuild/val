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
 * That ratio between building the index and querying it — 162 ms against
 * 0.2 ms — is also why the tool takes a LIST of queries rather than one.
 * Everything expensive about a call happens before the first query runs, so a
 * second query against the same index is free next to a second call, which pays
 * for the load and the build again. An agent exploring content asks several
 * near-identical things, because the whole point of searching is not knowing
 * which word the content uses; batching them turns five calls into one.
 *
 * It is also the wrong comparison that matters: the alternative is `get_source`
 * on every module so the model can read them itself, which moves the whole
 * corpus through the context window. This moves a handful of queries in and a
 * page of hits back for each.
 */

/** Low on purpose. See the numbers above: reaching it means something is wrong. */
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;

/**
 * Hits per query, and high because the expensive work is already done by the
 * time any of them is counted.
 *
 * A page-sized default made sense when the answer was a screen for a person to
 * scroll. It is a model reading this, and it can filter a long list far more
 * cheaply than it can ask again — a low default just buys a second call for
 * content it was going to look at anyway.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Queries per call.
 *
 * Not a cost bound — the index is built either way and each query is
 * sub-millisecond. It bounds the RESPONSE, which is `queries x limit` hits at
 * worst and is the only part of this that reaches a context window.
 */
const MAX_QUERIES = 20;

/** How many omitted module paths to name before summarising the rest. */
const MAX_NAMED_OMISSIONS = 20;

const ModulePatternSchema = z
  .array(z.string())
  .optional()
  .describe(
    'Module file path globs, e.g. ["/content/blogs/**"]. Matched against the whole module file path.',
  );

/**
 * One query or several.
 *
 * A bare string is accepted because a caller that means one query will send one
 * whatever the schema says, and refusing it teaches nothing. Normalised to a
 * list here so the handler and the response have a single shape.
 */
const QueriesSchema = z
  .union([z.string(), z.array(z.string()).min(1).max(MAX_QUERIES)])
  .transform((queries) => (typeof queries === "string" ? [queries] : queries));

export function searchContentTool(): ValToolImpl {
  return defineTool(
    {
      name: "search_content",
      title: "Search content",
      description:
        "Find content by text across the project's Val modules, with unpublished changes applied. Returns the source paths of matching values, which get_source reads. Pass every query you have in one call: the index is built per call and querying it is thousands of times cheaper than building it, so five queries cost about what one costs. Narrow with include/exclude when you know roughly where to look — that is also the fix if a search reports omitted modules.",
      inputSchema: z.object({
        queries: QueriesSchema.describe(
          `The text to search for: one string, or up to ${MAX_QUERIES} of them answered in a single pass over the index. Matches are on word prefixes, so "blog" finds "blogging". Prefer several guesses in one call over one call per guess — the content may not use the word you would.`,
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
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe(
            `Maximum hits to return PER QUERY, so a call returns up to queries x limit of them. Defaults to ${DEFAULT_LIMIT}; lower it when searching a common word across many queries at once.`,
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe("Number of hits to skip per query, for paging."),
        timeoutMs: z
          .number()
          .int()
          .min(100)
          .max(MAX_TIMEOUT_MS)
          .default(DEFAULT_TIMEOUT_MS)
          .describe(
            "How long to spend indexing before answering with what has been indexed so far. It bounds the indexing, which every query in the call shares — not the queries, which are free. The default is enough for any ordinary project; a search that reports omitted modules is better narrowed with include than given longer.",
          ),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, deps) => {
      // First occurrence wins, so the answers stay in the order they were
      // asked. A repeated query costs nothing to run and a duplicate page of
      // hits to read, and every answer names its own query, so collapsing them
      // loses nothing a caller can correlate by.
      const queries = [...new Set(args.queries.map((query) => query.trim()))];
      if (queries.some((query) => query === "")) {
        return err(
          "invalid-args",
          "One of the queries is empty, so there is nothing to search for.",
        );
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

      return ok({
        // Answered per query rather than merged, because which guess found the
        // thing is most of why several were asked. One query gets a list of
        // one: a response shape that changes with the arguments is a shape
        // every caller has to branch on.
        queries: queries.map((query) => {
          const found = performSearch(
            built.index,
            query,
            args.limit,
            args.offset,
          );
          return {
            query,
            results: found.results.map((hit) => ({
              path: hit.path,
              // What the Studio would show for this hit, so an agent and an
              // editor are looking at the same thing.
              label: hit.label,
              moduleFilePath: moduleOf(hit.path),
            })),
            // Matches for this query across the indexed modules, not the size
            // of the page above: it is how a caller knows whether narrowing or
            // paging is worth it.
            total: found.total,
            ...(found.totalIsLowerBound ? { totalIsLowerBound: true } : {}),
          };
        }),
        // What was actually searched, so the totals can be read for what they
        // are: counts over these modules, not over the project.
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
              hint: `Indexing stopped after ${args.timeoutMs}ms with ${built.omitted.length} module(s) unread, so these results are partial — for every query in this call, including the ones that found plenty. Search again with include set to the modules you care about, or use count_entries to see which of the omitted ones are large.`,
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
 * The deadline covers the indexing and nothing else, and there is nothing else
 * for it to cover: the queries run against the finished index in well under a
 * millisecond each, so no number of them can be what made a call slow.
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
