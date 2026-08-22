import type { PatchId } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";

/**
 * The subset of the `/stat` response this prototype reacts to.
 *
 * The real response also carries `baseSha` / `schemaSha` / `sourcesSha`, which
 * is how the schema and source stores learn they need to refetch. Left out here
 * because nothing in `system.test.ts` exercises it — the field it would add is
 * an input to `SchemaStore.receive`, not a new event.
 */
export type StatSnapshot = {
  /** The authoritative ordered patch-id list. Ids only — no ops. */
  patches: PatchId[];
};

/**
 * Owns "what does the server say exists right now".
 *
 * It is the only store with an outside input, and it deliberately knows nothing
 * about patch *contents*: `/stat` returns ids, and fetching the ops for them is
 * {@link PatchStore}'s job. Keeping that split is what makes a head of
 * `external-partial` a real state the system passes through rather than a
 * fiction — between `stat:receive` and `patch:receive` the system genuinely
 * knows a patch exists whose ops it has never seen.
 */
export class StatStore {
  readonly events = new StoreBus<SystemEvent>();

  private patches: PatchId[] = [];

  /**
   * Adopt a `/stat` result. The id list is authoritative and replaces what we
   * had, rather than being merged into it — the server can reorder.
   */
  receiveStat(snapshot: StatSnapshot): void {
    this.patches = [...snapshot.patches];
    this.events.emit({ type: "stat:receive", patches: [...this.patches] });
  }

  currentPatchIds(): PatchId[] {
    return [...this.patches];
  }
}
