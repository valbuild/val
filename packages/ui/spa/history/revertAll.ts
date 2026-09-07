import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
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
/**
 * Does this schema hold a `.jsonValues()` record anywhere inside it?
 *
 * Asked of the schema rather than sniffed from the value, for the same reason
 * media is: the schema is what decides how a value is stored, and a marker
 * object is not distinguishable from ordinary content by looking at it.
 */
export function containsJsonValues(schema: SerializedSchema): boolean {
  if (schema.type === "record") {
    return schema.jsonValues === true || containsJsonValues(schema.item);
  }
  if (schema.type === "object") {
    return Object.values(schema.items).some(containsJsonValues);
  }
  if (schema.type === "array") {
    return containsJsonValues(schema.item);
  }
  if (schema.type === "union") {
    return schema.items.some(containsJsonValues);
  }
  return false;
}

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
    if (containsJsonValues(module.schema)) {
      /*
       * A `.jsonValues()` record's entries are NOT in the module's Source.
       *
       * The Source holds `{ _type: "json" }` markers and the content lives in
       * each entry's own `*.val.json`. A root `replace` with the recorded
       * Source would therefore write those markers into the `.val.ts`, over the
       * `c.json(() => import(...))` calls that make the entries load at all —
       * and nothing downstream catches it, because the server routes an op at
       * the module root as a plain source edit.
       *
       * So it is left out, like any other module that cannot be put back.
       */
      blocked.push({
        moduleFilePath,
        reason:
          "This module's entries are stored separately, so it cannot be put back as a whole yet.",
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
