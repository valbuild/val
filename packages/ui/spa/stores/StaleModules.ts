import type { ModuleFilePath } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent, SystemEventType } from "./types";

/**
 * Which modules a worker-realm consumer owes a pass for. HOST side.
 *
 * This used to live inside each worker-realm store — `SearchStore` and
 * `ReferenceStore` both kept a stale set that the host pushed into
 * (`markStale`) and then read back (`needsIndex`, `staleModules`,
 * `indexedModules`). That works in one thread and cannot work across a seam:
 * a read over a thread boundary is a MESSAGE, so answering one query meant four
 * messages for information the host already had. The host is the side that saw
 * the change — it is what emits `source:patch-apply`.
 *
 * So the set lives here, and the worker-realm stores are pure: they are handed a
 * snapshot and a query, and they answer. Nothing is asked of them that they have
 * to be interrogated for first.
 *
 * One instance per consumer, because they go stale independently: opening the
 * search UI must not clear what the reference index owes.
 */
export class StaleModules {
  readonly events = new StoreBus<SystemEvent>();

  private stale = new Set<ModuleFilePath>();
  /** Modules a pass has actually covered, so a first query can scope itself. */
  private covered = new Set<ModuleFilePath>();

  constructor(
    /**
     * The event this consumer's invalidation is announced as.
     *
     * Passed in rather than derived, so the two instances stay distinguishable
     * on the ledger: "the search index went stale" and "the reference index went
     * stale" are different pieces of news even when one edit causes both.
     */
    private readonly invalidateEvent: Extract<
      SystemEventType,
      "search:invalidate" | "references:invalidate"
    >,
  ) {}

  mark(modules: ModuleFilePath[]): void {
    const newly = modules.filter(
      (moduleFilePath) => !this.stale.has(moduleFilePath),
    );
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
    }
    // Only when the set GREW. Typing 40 characters into one module makes it
    // stale once, and 39 further events would say nothing new — the same rule
    // every other store in this system follows.
    if (newly.length > 0) {
      this.events.emit({ type: this.invalidateEvent, modules: newly });
    }
  }

  /** Is a pass owed before the next query can be answered honestly? */
  needsPass(): boolean {
    return this.covered.size === 0 || this.stale.size > 0;
  }

  /**
   * Which modules the next query should be handed.
   *
   * `allLoaded` on a first pass, the stale set after that. The caller passes the
   * loaded set rather than this class reading it, because "what is loaded" is the
   * source store's business and this class is deliberately about one thing.
   */
  target(allLoaded: ModuleFilePath[]): ModuleFilePath[] {
    if (this.covered.size === 0) {
      return allLoaded;
    }
    return [...this.stale];
  }

  /**
   * Record that a pass covered these modules.
   *
   * Called with what the worker actually indexed, not with what was asked for: a
   * module the worker skipped (no schema, no source) must stay stale, or it never
   * gets another chance.
   */
  covers(modules: ModuleFilePath[]): void {
    for (const moduleFilePath of modules) {
      this.covered.add(moduleFilePath);
      this.stale.delete(moduleFilePath);
    }
  }

  /** For a module that has gone away rather than changed. */
  forget(moduleFilePath: ModuleFilePath): void {
    this.stale.delete(moduleFilePath);
    this.covered.delete(moduleFilePath);
  }

  /** Everything a pass has covered. */
  coveredModules(): ModuleFilePath[] {
    return [...this.covered];
  }

  /** Everything a pass still owes. */
  staleModules(): ModuleFilePath[] {
    return [...this.stale];
  }
}
