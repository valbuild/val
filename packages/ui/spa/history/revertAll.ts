import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type {
  HistoricalModule,
  HistoricalPatchSet,
} from "@valbuild/shared/internal";
import type { JSONValue, Patch } from "@valbuild/core/patch";

export type RevertPlan = {
  /** One patch per module, each replacing the module wholesale. */
  modules: { moduleFilePath: ModuleFilePath; patch: Patch }[];
  /**
   * Modules that can be put back as soon as their `.jsonValues()` entry
   * content has been read at the commit.
   *
   * Not blocked and not ready: the entries of such a module are not in its
   * Source - that holds `{_type:"json"}` markers - so the content has to be
   * fetched per entry (`/history/json`), and that is a round trip per entry.
   * Doing it when the commit is opened would mean fetching a thousand support
   * pages to render a button, so the keys are named here and fetched when
   * someone actually asks to put the module back.
   */
  needsJsonEntries: { moduleFilePath: ModuleFilePath; entryKeys: string[] }[];
  /** Modules this commit changed that CANNOT be put back, and why. */
  blocked: { moduleFilePath: ModuleFilePath; reason: string }[];
};

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
  if (schema.type === "discriminated-union") {
    return schema.items.some(containsJsonValues);
  }
  return false;
}

/** Is the module itself a `.jsonValues()` record - the only place one is allowed? */
function isRootJsonValues(schema: SerializedSchema): boolean {
  return schema.type === "record" && schema.jsonValues === true;
}

/** What putting ONE module back would take. */
export type ModuleRevert =
  | { kind: "patch"; value: JSONValue; patch: Patch }
  | { kind: "needs-json-entries"; entryKeys: string[] }
  | { kind: "blocked"; reason: string };

/**
 * Put one module back, or say what stops it.
 *
 * Both things that write a module's old value ask this: "Put everything back",
 * which does it for every module a commit changed, and "Restore this whole
 * module", which does it for one. They agreed by coincidence before, which is
 * exactly how one of them comes to write something the other refuses.
 *
 * The value is always CONTENT. For a `.jsonValues()` module the Source is
 * markers and the content lives in each entry's own `*.val.json`, so the
 * content is read at the commit and the record is rebuilt from it; handing the
 * Source back would write markers over the `c.json(() => import(...))` calls
 * that make the entries load. The server refuses that now, but the reason it
 * would be wrong is here, where the value is chosen.
 */
export function planModuleRevert(
  module: HistoricalModule,
  /** This module's entry content at the commit, keyed by entry key. */
  jsonEntries: Record<string, JSONValue> | undefined,
): ModuleRevert {
  if (module.schema === null) {
    return {
      kind: "blocked",
      reason:
        "This module was saved with a different version of Val, so it cannot be put back from here.",
    };
  }
  if (module.source === null) {
    /*
     * The commit DELETED this module, or nothing was recorded for it. Either
     * way "put it back" is not a `replace` — recreating a deleted module is
     * not something a patch can do, and inventing an empty one would delete
     * whatever is there now.
     */
    return {
      kind: "blocked",
      reason:
        "There is no recorded content for this module at that commit, so it is left as it is.",
    };
  }
  if (isRootJsonValues(module.schema)) {
    const source = module.source;
    if (
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source)
    ) {
      return {
        kind: "blocked",
        reason:
          "This module's entries were not recorded as a record at that commit, so it cannot be put back as a whole.",
      };
    }
    /*
     * The keys come from the Source and the content from the entry files.
     *
     * The Source is the one thing that says which entries the module HAD at the
     * commit - the markers are useless as content and exact as a key set - and
     * the whole record has to be named or the entries left out of it would be
     * removed as entries the commit did not have.
     */
    const entryKeys = Object.keys(source);
    const value: Record<string, JSONValue> = {};
    for (const entryKey of entryKeys) {
      const content = jsonEntries?.[entryKey];
      if (content === undefined) {
        return { kind: "needs-json-entries", entryKeys };
      }
      value[entryKey] = content;
    }
    return {
      kind: "patch",
      value,
      patch: [{ op: "replace", path: [], value }],
    };
  }
  if (containsJsonValues(module.schema)) {
    /*
     * A `.jsonValues()` record somewhere OTHER than the module root.
     *
     * Rejected at startup (the read path is root-only), so this is a schema no
     * running project has. Refusing rather than guessing where its entries'
     * content would come from.
     */
    return {
      kind: "blocked",
      reason:
        "This module stores entries outside itself in a way Val cannot put back as a whole.",
    };
  }
  return {
    kind: "patch",
    value: module.source,
    patch: [
      {
        op: "replace",
        // The empty path is the module root: replace the whole thing.
        path: [],
        value: module.source,
      },
    ],
  };
}

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
export function planRevertAll(
  patchSet: HistoricalPatchSet,
  /**
   * Entry content at the commit for `.jsonValues()` modules, by module then
   * entry key. Modules it does not cover come back as `needsJsonEntries`.
   */
  jsonEntries?: Record<ModuleFilePath, Record<string, JSONValue>>,
): RevertPlan {
  const modules: RevertPlan["modules"] = [];
  const needsJsonEntries: RevertPlan["needsJsonEntries"] = [];
  const blocked: RevertPlan["blocked"] = [];
  for (const [path, module] of Object.entries(patchSet.modules)) {
    const moduleFilePath = path as ModuleFilePath;
    const plan = planModuleRevert(module, jsonEntries?.[moduleFilePath]);
    if (plan.kind === "blocked") {
      blocked.push({ moduleFilePath, reason: plan.reason });
    } else if (plan.kind === "needs-json-entries") {
      needsJsonEntries.push({ moduleFilePath, entryKeys: plan.entryKeys });
    } else {
      modules.push({ moduleFilePath, patch: plan.patch });
    }
  }
  return { modules, needsJsonEntries, blocked };
}
