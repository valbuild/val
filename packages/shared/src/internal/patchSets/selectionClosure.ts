import type { PatchId } from "@valbuild/core";
import type { SerializedPatchSet } from "./PatchSets";

/**
 * Patch sets that share a change become one: a change is never split.
 *
 * Shared by the two places that move changes between branches a whole set at
 * a time -- the merge moving the site's conflicting pending changes
 * (`changesToMove` in `@valbuild/server`) and Publish selected
 * ({@link selectionClosure}) -- so that they agree on what "a whole set" is.
 */
export function joinSharedChanges(sets: PatchId[][]): Set<PatchId>[] {
  const groups: Set<PatchId>[] = [];
  for (const set of sets) {
    const joined = new Set(set);
    for (const group of groups.filter((g) => set.some((id) => g.has(id)))) {
      for (const id of group) joined.add(id);
      groups.splice(groups.indexOf(group), 1);
    }
    groups.push(joined);
  }
  return groups;
}

/**
 * What publishing `selected` publishes: every change in every patch set a
 * selected change is in, sets that share a change joined
 * (valbuild/val `docs/plans/remove-patch-groups.md`, Phase 4, rule 2).
 *
 * A patch set is changes that do not apply without each other, so a selection
 * of part of one cannot be published on its own. What it pulls in is someone
 * else's as often as not; the caller says whose, before anything moves.
 *
 * In the order of `patchIds` -- the chain's -- with nothing that is not in it.
 */
export function selectionClosure(
  patchSets: SerializedPatchSet,
  selected: Iterable<PatchId>,
  patchIds: readonly PatchId[],
): PatchId[] {
  const wanted = new Set(selected);
  const closed = new Set<PatchId>();
  for (const group of joinSharedChanges(
    patchSets.map((set) => set.patches.map((patch) => patch.patchId)),
  )) {
    if ([...group].some((id) => wanted.has(id))) {
      for (const id of group) closed.add(id);
    }
  }
  // A selected change no patch set knows of is its own set.
  for (const id of wanted) closed.add(id);
  return patchIds.filter((id) => closed.has(id));
}
