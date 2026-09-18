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
  /**
   * When each stale module was last marked, on a clock that only `mark` moves.
   *
   * A pass is a snapshot, an `await` across the seam, and then `covers`. A
   * change that lands during the await marks the module — and an unconditional
   * `covers` then cleared that mark, because the module was in the pass's
   * result. The next query answered from an index that had the change's
   * predecessor in it: for a discard, the discarded text was still findable.
   * So a pass takes the clock at {@link begin} and `covers` only clears marks
   * that predate it.
   */
  private markedAt = new Map<ModuleFilePath, number>();
  private clock = 0;

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
    this.clock++;
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
      this.markedAt.set(moduleFilePath, this.clock);
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
   * The moment a pass reads its input. Hand the result to {@link covers}.
   *
   * Taken BEFORE `target()` and the snapshot gather, so a mark made while the
   * pass is away across the seam is later than it and survives `covers`.
   */
  begin(): number {
    return this.clock;
  }

  /**
   * Record that a pass covered these modules.
   *
   * Called with what the worker actually indexed, not with what was asked for: a
   * module the worker skipped (no schema, no source) must stay stale, or it never
   * gets another chance.
   *
   * `since` is the pass's {@link begin}. A module marked after it changed while
   * the pass was in flight, so what the pass indexed is already behind: the
   * module stays stale and the next query pays for it again. Without `since`
   * every mark is cleared, which is only right for a pass nothing could have
   * interleaved with.
   */
  covers(modules: ModuleFilePath[], since?: number): void {
    for (const moduleFilePath of modules) {
      this.covered.add(moduleFilePath);
      if (
        since !== undefined &&
        (this.markedAt.get(moduleFilePath) ?? 0) > since
      ) {
        continue;
      }
      this.stale.delete(moduleFilePath);
      this.markedAt.delete(moduleFilePath);
    }
  }

  /** For a module that has gone away rather than changed. */
  forget(moduleFilePath: ModuleFilePath): void {
    this.stale.delete(moduleFilePath);
    this.covered.delete(moduleFilePath);
    this.markedAt.delete(moduleFilePath);
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
