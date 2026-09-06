import type { ModuleFilePath } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import type { JSONValue, Patch } from "@valbuild/core/patch";

export type RevertPlan = {
  /** One patch per module, each replacing the module wholesale. */
  modules: { moduleFilePath: ModuleFilePath; patch: Patch }[];
  /** Modules this commit changed that CANNOT be put back, and why. */
  blocked: { moduleFilePath: ModuleFilePath; reason: string }[];
};

/**
 * Put everything back the way it was at a commit.
 *
 * The case this exists for is the one people actually have: a publish went
 * wrong and they want it undone, all of it, now. Picking twenty fields one at a
 * time to undo one mistake is not a workflow, it is a punishment.
 *
 * One patch per module rather than one patch for everything: patches are scoped
 * to a module, and per-module means a module that cannot be reverted is left
 * out while the rest still go back — the same rule the whole feature follows,
 * that one broken thing must not take the others with it.
 *
 * A module the commit did not touch is NOT included. This reverts the commit's
 * own changes, not the project to a point in time — reverting a module the
 * commit never touched would undo somebody else's later work without saying so.
 */
export function planRevertAll(patchSet: HistoricalPatchSet): RevertPlan {
  const modules: RevertPlan["modules"] = [];
  const blocked: RevertPlan["blocked"] = [];
  for (const [path, module] of Object.entries(patchSet.modules)) {
    const moduleFilePath = path as ModuleFilePath;
    if (module.schema === null) {
      blocked.push({
        moduleFilePath,
        reason:
          "This module was saved with a different version of Val, so it cannot be put back from here.",
      });
      continue;
    }
    if (module.source === null) {
      /*
       * The commit DELETED this module, or nothing was recorded for it. Either
       * way "put it back" is not a `replace` — recreating a deleted module is
       * not something a patch can do, and inventing an empty one would delete
       * whatever is there now.
       */
      blocked.push({
        moduleFilePath,
        reason:
          "There is no recorded content for this module at that commit, so it is left as it is.",
      });
      continue;
    }
    modules.push({
      moduleFilePath,
      patch: [
        {
          op: "replace",
          // The empty path is the module root: replace the whole thing.
          path: [],
          value: module.source as JSONValue,
        },
      ],
    });
  }
  return { modules, blocked };
}
