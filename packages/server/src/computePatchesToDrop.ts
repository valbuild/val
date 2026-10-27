import { ModuleFilePath, PatchId } from "@valbuild/core";
import { PreparedCommit } from "./ValOps";

/**
 * Which unpublished changes a failed save has to throw away to make progress.
 *
 * `/save` used to refuse the whole commit when any one patch could not be
 * applied: nothing was written, for any module, and the change stayed on disk to
 * fail again on the next attempt. With auto-save that is not a refusal, it is a
 * dead stop — the editor keeps typing, every save fails on the same patch, and
 * nothing is ever written again.
 *
 * So in `fs` mode the failing change is removed instead, and the person editing
 * is told. The rule for what goes with it:
 *
 * **From the first failure onward, within that module.** A patch is a set of ops
 * against the source as the patches before it left it. Once one has not been
 * applied, every later patch in that module was computed against a state that no
 * longer exists, so keeping them would be keeping changes whose meaning has
 * already been lost. That is `triedPatches` (the one that failed) plus
 * `skippedPatches` (the tail that was never attempted).
 *
 * **Other modules are untouched.** `prepare` walks each module's chain
 * independently, so a broken chain in one file says nothing about another.
 *
 * **And a module that failed as a WHOLE keeps everything.** When the `.val.ts`
 * cannot be read at all, `prepare` reports every one of its patches as skipped
 * and names none of them as unappliable — the file is what failed, not the
 * changes. Deleting them there would be destroying good edits because a file was
 * missing for a moment: rename a module, or switch branch, with unsaved changes
 * to it and the next auto-save would silently take them all. Skipped is only
 * collateral when there is something in that module for it to be collateral OF.
 */
export type DroppedPatch = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  message: string;
};

/**
 * The message for a patch that did not itself fail but sits behind one that did.
 *
 * Worth distinguishing: "yours was broken" and "something before yours was
 * broken" are different things to be told, and only the first is a bug in the
 * change itself.
 */
function collateralMessage(moduleFilePath: ModuleFilePath): string {
  return `An earlier change to ${moduleFilePath} could not be applied, so this one no longer fits the content it was written against.`;
}

export function computePatchesToDrop(
  prepared: Pick<
    PreparedCommit,
    "triedPatches" | "skippedPatches" | "unappliablePatches"
  >,
): DroppedPatch[] {
  const dropped: DroppedPatch[] = [];
  const seen = new Set<PatchId>();

  const add = (moduleFilePath: ModuleFilePath, patchId: PatchId): void => {
    if (seen.has(patchId)) {
      return;
    }
    seen.add(patchId);
    dropped.push({
      patchId,
      moduleFilePath,
      message:
        prepared.unappliablePatches[patchId]?.message ??
        collateralMessage(moduleFilePath),
    });
  };

  // Tried before skipped, so the change that actually failed is named first —
  // it is the one worth reading.
  for (const [moduleFilePath, patchIds] of Object.entries(
    prepared.triedPatches,
  )) {
    for (const patchId of patchIds) {
      add(moduleFilePath as ModuleFilePath, patchId);
    }
  }
  /*
   * Which modules actually had a change fail, as opposed to being unreadable.
   *
   * `triedPatches` holds only failures, and `unappliablePatches` names the
   * failure itself, so between them they are the whole answer. A module in
   * neither has nothing to blame its skipped tail on.
   */
  const failedModules = new Set<ModuleFilePath>();
  for (const [moduleFilePath, patchIds] of Object.entries(
    prepared.triedPatches,
  )) {
    if (patchIds.length > 0) {
      failedModules.add(moduleFilePath as ModuleFilePath);
    }
  }
  for (const failure of Object.values(prepared.unappliablePatches)) {
    failedModules.add(failure.moduleFilePath);
  }

  for (const [moduleFilePath, patchIds] of Object.entries(
    prepared.skippedPatches,
  )) {
    if (!failedModules.has(moduleFilePath as ModuleFilePath)) {
      // The module failed as a whole. Its changes are fine and are kept, so the
      // save refuses instead — which is what it did before auto-save, and is
      // right here: this one resolves itself when the file comes back.
      continue;
    }
    for (const patchId of patchIds) {
      add(moduleFilePath as ModuleFilePath, patchId);
    }
  }

  /*
   * A patch reported unappliable that neither list holds.
   *
   * Belt and braces: the two lists are how `prepare` reports the shape of the
   * failure, and this is how it reports the failure itself. If they ever
   * disagree, leaving a patch behind means the next save fails on it again —
   * the exact dead stop this function exists to prevent.
   */
  for (const [patchId, failure] of Object.entries(
    prepared.unappliablePatches,
  )) {
    add(failure.moduleFilePath, patchId as PatchId);
  }

  return dropped;
}
