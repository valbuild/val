import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { JSONValue, Operation, Patch } from "@valbuild/core/patch";
import { diffToOps } from "./diffToOps";

/**
 * One thing a user can choose to put back.
 *
 * A patch rather than a bare op because that is what the grouping wants: each
 * unit carries its OWN patch id, and `PatchSets.insert` keys everything by
 * patch id. Handing it one patch with N ops silently drops N-1 of them - it
 * returns early for the second and later ops of an id it has already seen - so
 * "one op, one id" is not a stylistic choice, it is the contract.
 */
export type RestoreUnit = {
  /**
   * Synthetic and preview-only. This id NEVER reaches the server: a restore
   * that is actually accepted goes through `PatchStore.createPatch`, which is
   * the only thing allowed to mint an id the server will see (the server checks
   * `parentRef` against one linear chain, so a second minter is a 409 per
   * keystroke).
   */
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Patch;
  /** The single op, for a caller that wants it without unwrapping. */
  op: Operation;
};

export type RestorePreview = {
  units: RestoreUnit[];
  /** Modules that had no differences. Kept so a caller can say "nothing to
   * restore here" rather than showing an empty list with no explanation. */
  unchanged: ModuleFilePath[];
};

export type ModuleRestoreInput = {
  moduleFilePath: ModuleFilePath;
  /**
   * The source as the editor sees it NOW - the committed source with their
   * pending patches applied, not the committed source. Restoring is measured
   * against what is on screen.
   */
  current: JSONValue | null;
  /**
   * The source as the chosen commit left it: the commit's pre-patch source with
   * that commit's patches replayed. This is `HistoricalModule.after` from
   * `/history/commit`, which is immutable for a commit sha and cached.
   */
  atCommit: JSONValue | null;
};

/**
 * What it would take to put a commit's version of things back.
 *
 * The direction is current -> atCommit: these are the ops that would UNDO
 * everything that happened since, which is what "restore" means. They are not
 * the commit's original patches replayed - those were written against a source
 * that has since moved, and replaying them would apply the change again rather
 * than return to the result.
 *
 * Computes only. Nothing is written, nothing is uploaded, no id here is real.
 * A caller that wants to restore a unit takes its ops to
 * `PatchStore.createPatch`, which mints the real id and appends to the chain -
 * and if the chain has moved in between, this whole preview is recomputed
 * first, because `current` is what it was measured against.
 *
 * ## Why one unit per op
 *
 * The user picks what to put back, and the smallest thing they can pick is the
 * smallest thing `PatchSets` will group. Feed these units in and the grouping
 * falls out by path, which is exactly the independent-sets shape the UI wants.
 *
 * `mintId` is a parameter so a preview is reproducible in tests and so a caller
 * can key React rows on something stable across recomputes.
 */
export function computeRestorePatches(
  modules: ModuleRestoreInput[],
  mintId: (moduleFilePath: ModuleFilePath, index: number) => PatchId,
): RestorePreview {
  const units: RestoreUnit[] = [];
  const unchanged: ModuleFilePath[] = [];

  for (const { moduleFilePath, current, atCommit } of modules) {
    if (atCommit === null) {
      // Nothing was reconstructed for this module - it could not be read at
      // that commit. There is no target to restore TO, and the reason is
      // already on the module's `failures`.
      continue;
    }
    if (current === null) {
      // The module exists at the commit but not now. Restoring it means writing
      // the whole thing back, which is one decision rather than a field-by-field
      // diff against nothing.
      units.push(
        unit(
          moduleFilePath,
          { op: "replace", path: [], value: atCommit },
          0,
          mintId,
        ),
      );
      continue;
    }
    const ops = diffToOps(current, atCommit);
    if (ops.length === 0) {
      unchanged.push(moduleFilePath);
      continue;
    }
    ops.forEach((op, index) => {
      units.push(unit(moduleFilePath, op, index, mintId));
    });
  }

  return { units, unchanged };
}

function unit(
  moduleFilePath: ModuleFilePath,
  op: Operation,
  index: number,
  mintId: (moduleFilePath: ModuleFilePath, index: number) => PatchId,
): RestoreUnit {
  return {
    patchId: mintId(moduleFilePath, index),
    moduleFilePath,
    patch: [op],
    op,
  };
}

/**
 * A stable id for a preview unit.
 *
 * Derived from the module and the op's position rather than random, so
 * recomputing a preview against an unchanged source produces the same ids -
 * which is what keeps a React list from remounting every row whenever the patch
 * chain moves for an unrelated reason.
 */
export function previewPatchId(
  moduleFilePath: ModuleFilePath,
  index: number,
): PatchId {
  return `restore:${moduleFilePath}:${index}` as PatchId;
}
