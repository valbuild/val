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
  { source: Json; schema: SerializedSchema }
>;

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
 * the system — so it never happens as a side effect of an edit. A patch marks
 * modules stale (pushed in by the host side) and the index is rebuilt only when
 * `buildIndex` is called, in practice when the search UI opens. So the clone is
 * paid per search session, not per keystroke.
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
  private stale = new Set<ModuleFilePath>();

  constructor(private readonly activity: ActivitySink = noopActivity) {}

  /**
   * Pushed in from the host realm, because an event emitted there is not
   * observable here — `EventTarget` dispatch is per-realm.
   */
  markStale(modules: ModuleFilePath[]): void {
    const newlyStale = modules.filter(
      (moduleFilePath) => !this.stale.has(moduleFilePath),
    );
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
   * Is a build owed before the next query can be answered honestly?
   *
   * True when there is no index at all, and when modules have changed since the
   * one there is was built. The host side asks this so that a QUERY pays for the
   * index — answering `no-index` instead put the burden on the caller to know it
   * had to prime the store first, and a caller that forgot got an empty result
   * set, which reads as "nothing found" rather than "nothing indexed".
   */
  needsIndex(): boolean {
    return this.index === null || this.stale.size > 0;
  }

  /** Which modules the next query owes an index pass for. */
  staleModules(): ModuleFilePath[] {
    return [...this.stale];
  }

  /** Everything currently in the index. */
  indexedModules(): ModuleFilePath[] {
    return [...this.indexed];
  }

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
   * decides which those are (`staleModules()`), because only the host side can
   * gather source.
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
      this.stale.delete(moduleFilePath);
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
  forget(moduleFilePath: ModuleFilePath): void {
    if (this.index !== null) {
      removeModule(this.index, moduleFilePath);
    }
    this.indexed.delete(moduleFilePath);
    this.stale.delete(moduleFilePath);
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
    this.stale.clear();
    return this.reindex(snapshot);
  }

  async search(
    query: string,
    limit?: number,
    offset?: number,
  ): Promise<SearchResult> {
    if (this.index === null) {
      return { status: "no-index" };
    }
    this.activity.work("search:query", query);
    const { results, total } = performSearch(this.index, query, limit, offset);
    return {
      status: "results",
      results,
      total,
      staleModules: [...this.stale],
    };
  }
}
