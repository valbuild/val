import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

/**
 * REALM: host.
 *
 * A bounded cache of reconstructed commits, keyed by commit sha.
 *
 * ## Why a store and not just the HTTP cache
 *
 * `/history/commit` is already `immutable`, so the browser will not re-fetch
 * one. What it WILL do is re-parse the JSON and hand back a new object graph
 * every time - and comparing commits means flipping between them repeatedly,
 * with each flip re-deriving a value that cannot have changed.
 *
 * Holding the parsed value also keeps reference identity stable across reads,
 * which is what lets a React consumer skip re-rendering when it asks for the
 * same commit twice. That property is load-bearing elsewhere in these stores
 * (see `stores/architecture.md`) and is the actual reason this exists.
 *
 * ## Why bounded, and why this bound
 *
 * A reconstructed commit carries every changed module's source twice - before
 * and after - so a big commit is not small. Twenty is enough for the thing
 * people actually do (walk back through recent commits, compare a handful) and
 * small enough that a long session cannot quietly hold a project's entire
 * history in memory.
 *
 * ## What is NOT cached here
 *
 * Binary file bytes: they are `<img src>` against an immutable URL, so the
 * browser's own cache serves them, across sessions, without any of them passing
 * through JS.
 *
 * The comparison against current source (`/history/compare`): it depends on
 * source that moves with every keystroke, so a cached one would be wrong more
 * often than right. It is cheap precisely because the reconstruction it builds
 * on is cached here.
 */
const MAX_ENTRIES = 20;

export class HistoryStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * Insertion-ordered, which is what makes eviction LRU: `Map` iterates in
   * insertion order, so the first key is the least recently used - provided
   * every read re-inserts, which `get` does.
   */
  private commits = new Map<string, HistoricalPatchSet>();

  get(commitSha: string): HistoricalPatchSet | undefined {
    const hit = this.commits.get(commitSha);
    if (hit !== undefined) {
      this.commits.delete(commitSha);
      this.commits.set(commitSha, hit);
    }
    return hit;
  }

  has(commitSha: string): boolean {
    return this.commits.has(commitSha);
  }

  set(commitSha: string, patchSet: HistoricalPatchSet): void {
    this.commits.delete(commitSha);
    this.commits.set(commitSha, patchSet);
    while (this.commits.size > MAX_ENTRIES) {
      const oldest = this.commits.keys().next();
      if (oldest.done) break;
      this.commits.delete(oldest.value);
    }
  }

  /**
   * No invalidation, deliberately: a reconstructed commit cannot change, so
   * there is nothing to invalidate. This is for tests and for freeing memory
   * when a session leaves the history UI entirely.
   */
  clear(): void {
    this.commits.clear();
  }

  get size(): number {
    return this.commits.size;
  }
}
