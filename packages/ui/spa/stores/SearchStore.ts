import type {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import {
  createSearchIndex,
  indexModule,
  performSearch,
  removeModule,
  type SearchIndex,
} from "../search/searchIndex";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import { noopActivity, type ActivitySink } from "./activity";

/** What has to be cloned across the worker seam to index. */
export type SourceSnapshot = Record<
  ModuleFilePath,
  {
    source: Json;
    schema: SerializedSchema;
    /**
     * Is this source everything the module has?
     *
     * `false` for a `.jsonValues()` module with entry content still unfetched.
     * It travels IN the snapshot rather than being asked for later because this
     * store cannot ask: the fact lives in the source store, on the far side of
     * the worker seam, and the snapshot is the only thing that crosses it.
     */
    complete: boolean;
  }
>;

/**
 * What the worker realm can answer about a query.
 *
 * No `staleModules`: staleness is HOST state now (`StaleModules`), because the
 * host is the side that saw the change. Each realm reports what it knows — the
 * worker knows completeness (it travels in the snapshot), the host knows
 * staleness — and {@link SearchResult} is the two joined at the system boundary.
 */
export type WorkerSearchResult =
  | { status: "no-index" }
  | {
      status: "results";
      results: { path: SourcePath; label: string }[];
      total: number;
      /**
       * Modules that were indexed from an INCOMPLETE source — a `.jsonValues()`
       * record whose entry content has not been fetched.
       *
       * Distinct from staleness, which the HOST tracks: stale means "re-index
       * me", incomplete means "load more content first". Collapsing them would
       * tell a caller to re-index, which would walk the same partial source
       * again and change nothing.
       */
      partialModules: ModuleFilePath[];
    };

/**
 * What a CALLER gets: the worker's answer plus the host's staleness.
 *
 * `staleModules` stays on the result even though the worker no longer tracks it,
 * because the result is what a caller acts on: "these results are missing an
 * edit" is the honest label, and making a caller ask a second question for it is
 * how "search silently can't find things" happens.
 */
export type SearchResult =
  | { status: "no-index" }
  | (Extract<WorkerSearchResult, { status: "results" }> & {
      /**
       * Modules that changed since the index was built. The results are still
       * useful — they are just missing those modules' edits, which matters for
       * "why isn't my new text findable" far more than for "find me the page".
       */
      staleModules: ModuleFilePath[];
    });

/**
 * REALM: worker.
 *
 * Holds NO reference to any other store, and that is deliberate rather than
 * stylistic: it lives across a thread boundary, so it could not read one. The
 * snapshot it needs is a parameter to `buildIndex`, which puts the structured
 * clone in the signature instead of hiding it behind a store reference that
 * would silently stop working the moment this really moved.
 *
 * ## Build on demand, and say what got indexed
 *
 * Indexing walks every leaf of every module — the most expensive operation in
 * the system — so it never happens as a side effect of an edit. The index is
 * rebuilt only when a query asks for it, in practice when the search UI opens.
 * So the clone is paid per search session, not per keystroke.
 *
 * **Staleness is NOT tracked here**, and moving it out is what made this store
 * crossable. It used to keep a stale set that the host pushed into and then read
 * back — `needsIndex()`, `staleModules()`, `indexedModules()`, three synchronous
 * questions asked BEFORE a snapshot could be gathered. Across a thread boundary
 * a read is a message, so one query was four messages for information the host
 * already had: the host is the side that saw the change. It keeps the set now
 * (`StaleModules` in `createSystem.ts`) and this store is pure index.
 *
 * `search:build-index` reports `new` and `all` separately so a caller can tell
 * "the index grew" from "the index was rebuilt", and so a result set can be
 * honestly labelled partial: `.jsonValues()` entries whose content has not
 * loaded are skipped by the index walk, so a partial index is the normal case,
 * and returning results without saying so is how "search silently can't find
 * things" happens.
 */
export class SearchStore {
  readonly events = new StoreBus<SystemEvent>();

  private index: SearchIndex | null = null;
  private indexed = new Set<ModuleFilePath>();
  /** Modules whose last index pass walked source that was not all of it. */
  private partial = new Set<ModuleFilePath>();

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  /**
   * Index the modules in `snapshot`, leaving every other module's documents
   * alone.
   *
   * Incremental per module, which is possible because the document ids ARE the
   * source paths: `SearchIndex` keeps which ids came from which module, so one
   * module's documents can be dropped and re-added without walking any other.
   * Editing one field of one module used to mean re-walking every leaf of every
   * module in the project — the most expensive walk in the system, paid in full
   * for a change to one string.
   *
   * `snapshot` must carry the modules to index and nothing else; the caller
   * decides which those are, because only the host side can gather source — and
   * because only the host side knows what changed. See `StaleModules` in
   * `createSystem.ts`.
   */
  async reindex(snapshot: SourceSnapshot): Promise<{
    new: ModuleFilePath[];
    all: ModuleFilePath[];
  }> {
    const target = Object.keys(snapshot) as ModuleFilePath[];
    if (this.index === null) {
      this.index = createSearchIndex();
    }
    const added: ModuleFilePath[] = [];
    for (const moduleFilePath of target) {
      this.activity.work("search:index-module", moduleFilePath);
      const entry = snapshot[moduleFilePath];
      indexModule(this.index, moduleFilePath, entry.source, entry.schema);
      if (!this.indexed.has(moduleFilePath)) {
        added.push(moduleFilePath);
      }
      this.indexed.add(moduleFilePath);
      // Set AND cleared from the same flag, so a module that was partial and has
      // since had its content loaded stops being reported the moment it is
      // re-indexed — the alternative is a project that never stops looking
      // incomplete once any entry was ever unloaded.
      if (entry.complete) {
        this.partial.delete(moduleFilePath);
      } else {
        this.partial.add(moduleFilePath);
      }
    }
    const result = { new: added, all: [...this.indexed] };
    this.events.emit({ type: "search:build-index", ...result });
    return result;
  }

  /**
   * Drop a module from the index entirely.
   *
   * For a module that has gone away, as opposed to one that changed: leaving its
   * documents in place makes them searchable, and a hit on one navigates to a
   * path that no longer exists.
   */
  async forget(moduleFilePath: ModuleFilePath): Promise<void> {
    if (this.index !== null) {
      removeModule(this.index, moduleFilePath);
    }
    this.indexed.delete(moduleFilePath);
    this.partial.delete(moduleFilePath);
  }

  /**
   * Index everything in `snapshot` from scratch, discarding what was there.
   *
   * Kept for the case where the whole index is suspect — a schema-wide change,
   * or a first build. Routine change is served by {@link reindex}.
   */
  async buildIndex(snapshot: SourceSnapshot): Promise<{
    new: ModuleFilePath[];
    all: ModuleFilePath[];
  }> {
    this.activity.work(
      "search:build-index",
      undefined,
      Object.keys(snapshot).length,
    );
    this.index = createSearchIndex();
    this.indexed = new Set();
    this.partial.clear();
    return this.reindex(snapshot);
  }

  async search(
    query: string,
    limit?: number,
    offset?: number,
  ): Promise<WorkerSearchResult> {
    if (this.index === null) {
      return { status: "no-index" };
    }
    this.activity.work("search:query", query);
    const { results, total } = performSearch(this.index, query, limit, offset);
    return {
      status: "results",
      results,
      total,
      partialModules: [...this.partial],
    };
  }
}
