import type { Json, ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  buildSearchIndex,
  performSearch,
  type SearchIndex,
} from "../search/searchIndex";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { SourceStore } from "./SourceStore";

export type SearchResult =
  | { status: "no-index" }
  | {
      status: "results";
      results: { path: SourcePath; label: string }[];
      total: number;
      /**
       * Modules that changed since the index was built. The results are still
       * useful — they are just missing those modules' edits, which matters for
       * "why isn't my new text findable" far more than for "find me the page".
       */
      staleModules: ModuleFilePath[];
    };

/**
 * Owns the full-text index over every leaf value in the project.
 *
 * ## Build on demand, and say what got indexed
 *
 * Indexing is the most expensive thing in the system — it walks every leaf of
 * every module — so it never happens as a side effect of an edit. A patch marks
 * modules stale and emits `search:invalidate`; the index is (re)built only when
 * `buildIndex()` is called, which in practice is when the search UI opens.
 *
 * `search:build-index` reports `new` and `all` separately so a caller can tell
 * "the index grew" from "the index was rebuilt" — and so a result set can be
 * honestly labelled partial. `.jsonValues()` entries whose content has not
 * loaded are skipped by the index walk, so a partial index is the normal case
 * rather than an error, and returning results without saying so is how "search
 * silently can't find things" happens.
 */
export class SearchStore {
  readonly events = new StoreBus<SystemEvent>();

  private index: SearchIndex | null = null;
  private indexed = new Set<ModuleFilePath>();
  private stale = new Set<ModuleFilePath>();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly sourceStore: SourceStore,
  ) {}

  listenTo(): () => void {
    const offApply = this.sourceStore.events.on(
      "source:patch-apply",
      (event) => {
        this.markStale(event.modules);
      },
    );
    const offInit = this.sourceStore.events.on("source:init", (event) => {
      this.markStale(event.sources);
    });
    return () => {
      offApply();
      offInit();
    };
  }

  private markStale(modules: ModuleFilePath[]): void {
    const newlyStale = modules.filter((m) => !this.stale.has(m));
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
    }
    // Only when the stale SET grew: typing 40 characters into one module makes
    // it stale once, and 39 further events would say nothing new.
    if (newlyStale.length > 0) {
      this.events.emit({ type: "search:invalidate", modules: newlyStale });
    }
  }

  /**
   * Build (or rebuild) the index from whatever is loaded right now.
   *
   * A full rebuild, not an incremental update: FlexSearch can remove and re-add
   * documents by id, but `buildSearchIndex` derives its ids from the walk, so
   * incremental update needs a per-module id list this prototype does not keep.
   * Rebuilding is the honest version — and because it is on demand rather than
   * per keystroke, it is a cost paid once per search session instead of 40 times
   * per field.
   */
  async buildIndex(): Promise<{
    new: ModuleFilePath[];
    all: ModuleFilePath[];
  }> {
    const schemas = this.schemaStore.all();
    const modules: Record<
      ModuleFilePath,
      { source: Json; schema: (typeof schemas)[ModuleFilePath] }
    > = {};
    for (const moduleFilePath of this.sourceStore.loadedModules()) {
      const schema = schemas[moduleFilePath];
      const source = this.sourceStore.moduleSource(moduleFilePath);
      // A module without a schema cannot be walked — the walk is schema-driven.
      // Skipping it keeps it out of `all`, so it reads as not-indexed rather
      // than as indexed-and-empty.
      if (schema === undefined || source === undefined) continue;
      modules[moduleFilePath] = { source, schema };
    }
    this.index = buildSearchIndex(modules);
    const all = Object.keys(modules) as ModuleFilePath[];
    const added = all.filter(
      (moduleFilePath) => !this.indexed.has(moduleFilePath),
    );
    this.indexed = new Set(all);
    this.stale.clear();
    const result = { new: added, all };
    this.events.emit({ type: "search:build-index", ...result });
    return result;
  }

  async search(
    query: string,
    limit?: number,
    offset?: number,
  ): Promise<SearchResult> {
    if (this.index === null) {
      return { status: "no-index" };
    }
    const { results, total } = performSearch(this.index, query, limit, offset);
    return {
      status: "results",
      results,
      total,
      staleModules: [...this.stale],
    };
  }
}
