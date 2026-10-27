import type { PatchId } from "@valbuild/core";

/**
 * What the patch-set grouping still owes, and whether it can be appended to.
 * HOST side.
 *
 * ## Why the host decides
 *
 * The same reason `StaleModules` is on the host: the host is the side that SAW
 * the change. It emits `patch:create`, `patch:drop` and `stat:receive`, so it
 * already knows whether the chain grew at the end or was restructured. The
 * grouping store is across the worker seam, so asking IT would be a message —
 * and worse, it would then have to be handed the whole chain in order to answer,
 * which is the cost this class exists to avoid.
 *
 * ## Why a prefix test rather than a list of "required moments"
 *
 * `PatchSets.insert` is order-sensitive: it merges and re-orders patch sets based
 * on the order things arrive in, and `PatchSets` has no removal at all. So
 * appending is only sound when the chain has grown AT THE END and nothing before
 * that has moved.
 *
 * The obvious implementation is to enumerate the moments that break that — a
 * drop, a publish, another session's patch landing between two of ours, a schema
 * swapped under existing patches — and force a rebuild at each. That is a list
 * that has to stay complete forever, and the failure when it is not is silent:
 * a grouping that disagrees with the chain and nothing that says so.
 *
 * So instead: keep the ids in the order they were inserted, and compare them
 * against the chain as it now is. If what we hold is a PREFIX of the chain, the
 * difference is an append and only the suffix needs inserting. Anything else — a
 * reorder, a removal, a truncation — fails the test and rebuilds. The "required
 * moments" are then derived rather than remembered, and a case nobody thought of
 * is handled by falling back to the safe answer.
 *
 * {@link invalidate} still exists, for the one change the ids cannot show: a
 * SCHEMA replaced under patches that are otherwise untouched. Patch sets are
 * grouped using the schema at the op's path, so previously-inserted ops were
 * grouped against a schema that no longer exists.
 */
export type PatchSetPlan =
  /** Nothing to do; the grouping is current. Payload: nothing crosses. */
  | { mode: "current" }
  /** Insert these ids on top of what is there. Payload: only the new records. */
  | { mode: "append"; patchIds: PatchId[] }
  /** Throw it away and insert the whole chain. Payload: the chain. */
  | { mode: "rebuild"; patchIds: PatchId[] };

export class PatchSetChain {
  /** The ids the grouping holds, in the order they were inserted. */
  private inserted: PatchId[] = [];
  private mustRebuild = true;

  /**
   * What the next read has to do to be current.
   *
   * Pure: it does not record anything. {@link covers} is the separate call that
   * says the plan was carried out, because a plan that failed — a worker that
   * threw, a message that was never answered — must not leave this class
   * believing the grouping moved.
   */
  plan(chain: readonly PatchId[]): PatchSetPlan {
    if (this.mustRebuild) {
      return { mode: "rebuild", patchIds: [...chain] };
    }
    if (this.inserted.length > chain.length) {
      // The chain SHRANK, so something was removed. `PatchSets` cannot remove.
      return { mode: "rebuild", patchIds: [...chain] };
    }
    for (let index = 0; index < this.inserted.length; index++) {
      if (this.inserted[index] !== chain[index]) {
        // Not a prefix: something before the end moved. Appending here would
        // produce a grouping ordered differently from the chain, which is the
        // failure this test exists to make impossible.
        return { mode: "rebuild", patchIds: [...chain] };
      }
    }
    const suffix = chain.slice(this.inserted.length);
    if (suffix.length === 0) {
      return { mode: "current" };
    }
    return { mode: "append", patchIds: suffix };
  }

  /** The plan was carried out. This is now what the grouping holds. */
  covers(plan: PatchSetPlan): void {
    if (plan.mode === "current") {
      return;
    }
    if (plan.mode === "rebuild") {
      this.inserted = [...plan.patchIds];
      this.mustRebuild = false;
      return;
    }
    this.inserted = [...this.inserted, ...plan.patchIds];
  }

  /**
   * Force a rebuild on the next read.
   *
   * For a change the ids cannot show — a schema replaced under existing patches —
   * and for a reset of the grouping itself.
   */
  invalidate(): void {
    this.mustRebuild = true;
    this.inserted = [];
  }

  /** What the grouping holds, for a test or a debug view. */
  insertedPatchIds(): PatchId[] {
    return [...this.inserted];
  }
}
