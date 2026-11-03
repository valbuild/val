import type { Api } from "@valbuild/shared/internal";
import type { z } from "zod";
import type { PatchId } from "@valbuild/core";
import type { StatSnapshot } from "../StatStore";

/**
 * What the stores take from a `/stat` answer: the one mapping from what the
 * server said to what `StatStore.receiveStat` takes.
 *
 * Used by the provider's intake (`ValStoreProvider`, fed by the poll in
 * `useStatus`), by the re-sync after a parent conflict (`createValSystem`),
 * and by the scenario harness (`scenarios/`). It was two copies, and one of
 * them dropped a field the other took: one mapping, so the stores never
 * adopt half an answer.
 */
export function statSnapshotOf(stat: StatSnapshotSource): StatSnapshot {
  return {
    baseSha: stat.baseSha,
    sourcesSha: stat.sourcesSha,
    patches: stat.patches,
    appliedPatches: stat.appliedPatches,
    headCommitSha: stat.headCommitSha,
    // The new head is the whole point of a re-sync: a conflict means the
    // parent we named was not it. `fs` answers without one.
    headPatchId: stat.headPatchId,
    headVersion: stat.headVersion,
    ...(stat.version !== undefined ? { seq: stat.version.seq } : {}),
    // Drained by the server as it answers (`fs` mode), so dropped here they
    // are lost: nobody is told their unpublished work was removed.
    ...(stat.removed !== undefined ? { removed: stat.removed } : {}),
  };
}

/**
 * The parts of a `/stat` answer the stores read. Structural, so a 200 body
 * (`StatResponseJson`), the poll's `StatData` and the provider's `stat` prop
 * all fit without being converted first.
 */
export type StatSnapshotSource = {
  baseSha: string;
  patches: PatchId[];
  sourcesSha?: string;
  appliedPatches?: PatchId[];
  headCommitSha?: string;
  headPatchId?: PatchId | null;
  headVersion?: number;
  /** The answer's project version: only its `seq` is taken. */
  version?: { seq: number };
  removed?: { patchId: PatchId; reason: string }[];
};

/** The 200 body of `/stat`. */
export type StatResponseJson = Extract<
  z.infer<Api["/stat"]["POST"]["res"]>,
  { status: 200 }
>["json"];
