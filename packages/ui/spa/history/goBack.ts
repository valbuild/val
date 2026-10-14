import type { ModuleFilePath } from "@valbuild/core";
import {
  deepEqual,
  type JSONValue,
  type Patch,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import type { HistoricalModule } from "@valbuild/shared/internal";
import { planModuleRevert } from "./revertAll";

/** One module, as it was at the commit and as it is now. */
export type GoBackModule = {
  moduleFilePath: ModuleFilePath;
  /**
   * As it was at the commit (`/history/module`, which answers "as of"), or
   * `null` when history has no record of it at or before the commit.
   */
  atCommit: HistoricalModule | null;
  /** As it is now, entries in place; `undefined` when it has not loaded. */
  now: ReadonlyJSONValue | undefined;
};

/**
 * What "Go back to this point" writes: every module whose content differs
 * from what it was at the commit, put back whole -- not only the modules that
 * commit changed, which is "Put everything back".
 *
 * The rest is said rather than dropped: a module history has no record of is
 * left as it is (`unrecorded`), and one that cannot be put back says why
 * (`blocked`). Content only: a module that did not exist then is code, and
 * code is staged, not patched.
 */
export type GoBackPlan = {
  modules: { moduleFilePath: ModuleFilePath; patch: Patch }[];
  unchanged: ModuleFilePath[];
  needsJsonEntries: { moduleFilePath: ModuleFilePath; entryKeys: string[] }[];
  unrecorded: ModuleFilePath[];
  blocked: { moduleFilePath: ModuleFilePath; reason: string }[];
};

export function planGoBack(
  modules: readonly GoBackModule[],
  jsonEntries?: Partial<Record<ModuleFilePath, Record<string, JSONValue>>>,
  options?: {
    /**
     * Write every module, equal to now or not. For a go-back that brings the
     * code back as well: the `.val` files staged with it hold the content of
     * when their build was made, so every module is written over them.
     */
    everyModule?: boolean;
  },
): GoBackPlan {
  const plan: GoBackPlan = {
    modules: [],
    unchanged: [],
    needsJsonEntries: [],
    unrecorded: [],
    blocked: [],
  };
  // Sorted, so the same commit plans the same patches in the same order.
  const sorted = [...modules].sort((a, b) =>
    a.moduleFilePath.localeCompare(b.moduleFilePath),
  );
  for (const { moduleFilePath, atCommit, now } of sorted) {
    if (atCommit === null) {
      plan.unrecorded.push(moduleFilePath);
      continue;
    }
    const revert = planModuleRevert(atCommit, jsonEntries?.[moduleFilePath]);
    if (revert.kind === "blocked") {
      plan.blocked.push({ moduleFilePath, reason: revert.reason });
    } else if (revert.kind === "needs-json-entries") {
      plan.needsJsonEntries.push({
        moduleFilePath,
        entryKeys: revert.entryKeys,
      });
    } else if (
      !options?.everyModule &&
      now !== undefined &&
      deepEqual(now, revert.value)
    ) {
      plan.unchanged.push(moduleFilePath);
    } else {
      plan.modules.push({ moduleFilePath, patch: revert.patch });
    }
  }
  return plan;
}
