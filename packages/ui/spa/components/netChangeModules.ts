import type { ModuleFilePath } from "@valbuild/core";

/**
 * Which modules `useHasNetChanges` compares with what is published, and
 * whether one of them already counts as changed without comparing.
 *
 * A module a running publish is changing has no published value to compare
 * against: its base is about to move. So a pending change there counts as a
 * change, whatever the chain nets to -- while A→B publishes, a saved B→A nets
 * to nothing against A and was reported "reverted", disabling Publish over the
 * one change that undoes B. A module only a running publish touches is not
 * compared at all: Publish would not send it.
 */
export function netChangeModules(
  records: readonly { patchId: string; moduleFilePath: ModuleFilePath }[],
  committed: ReadonlySet<string>,
  publishing: ReadonlySet<string>,
  /**
   * Changes outside this tab's patch group. Publish does not send them, so
   * they are never what makes a module "changed" under a running publish --
   * they are compared as they always were, which reads them as unstaged rather
   * than as work to publish.
   */
  unstaged: ReadonlySet<string> = new Set(),
): { compare: ModuleFilePath[]; changesOnPublishing: boolean } {
  const staged = new Set<ModuleFilePath>();
  const unstagedModules = new Set<ModuleFilePath>();
  const inFlight = new Set<ModuleFilePath>();
  for (const record of records) {
    // A patch that has shipped is history, not pending work: its two sides
    // are equal BECAUSE it shipped, which is the opposite of a no-op.
    if (committed.has(record.patchId)) continue;
    if (publishing.has(record.patchId)) {
      inFlight.add(record.moduleFilePath);
    } else if (unstaged.has(record.patchId)) {
      unstagedModules.add(record.moduleFilePath);
    } else {
      staged.add(record.moduleFilePath);
    }
  }
  const compare = new Set<ModuleFilePath>(unstagedModules);
  let changesOnPublishing = false;
  for (const module of staged) {
    if (inFlight.has(module)) changesOnPublishing = true;
    else compare.add(module);
  }
  return { compare: [...compare], changesOnPublishing };
}
