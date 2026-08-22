import type {
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import {
  buildSearchIndex,
  performSearch,
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
   * Build (or rebuild) the index from the given snapshot.
   *
   * A full rebuild, not an incremental update: FlexSearch can remove and re-add
   * documents by id, but `buildSearchIndex` derives ids inside its own walk, so
   * incremental update needs a per-module document-id list this prototype does
   * not keep.
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
    this.index = buildSearchIndex(snapshot);
    const all = Object.keys(snapshot) as ModuleFilePath[];
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
