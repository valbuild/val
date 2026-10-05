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
): { compare: ModuleFilePath[]; changesOnPublishing: boolean } {
  const pending = new Set<ModuleFilePath>();
  const inFlight = new Set<ModuleFilePath>();
  for (const record of records) {
    // A patch that has shipped is history, not pending work: its two sides
    // are equal BECAUSE it shipped, which is the opposite of a no-op.
    if (committed.has(record.patchId)) continue;
    if (publishing.has(record.patchId)) {
      inFlight.add(record.moduleFilePath);
    } else {
      pending.add(record.moduleFilePath);
    }
  }
  const compare = [...pending].filter((module) => !inFlight.has(module));
  return {
    compare,
    changesOnPublishing: compare.length < pending.size,
  };
}
