import { PatchId } from "@valbuild/core";
import { SerializedPatchSet } from "./PatchSets";

/**
 * A patch group is the set of patches a user has chosen to publish.
 *
 * Not to be confused with a *patch set* (see `PatchSets.ts`), and the difference
 * is load-bearing:
 *
 * - a **patch set** is *computed* from the schema — the patches that must move
 *   together, because applying one without the others would be wrong;
 * - a **patch group** is *curated* — what this user staged.
 *
 * The one rule relating them is the prefix invariant:
 *
 * > For every patch group `G` and every patch set `PS`, `G ∩ PS` must be a
 * > **prefix** of `PS` in patch-chain order.
 *
 * A prefix rather than an arbitrary subset because within a patch set the
 * patches are, by construction, dependent on their predecessors: if
 * `PS = [p1, p2, p3]` and `G` holds `p1` and `p3` but not `p2`, then `p3`'s
 * array indices were computed against a state in which `p2` had been applied.
 * Skipping `p2` either errors or silently writes to the wrong index.
 *
 * Everything in this module is a consequence of that one rule:
 * `stageClosure` restores the invariant by growing forwards-from-the-start,
 * `unstageClosure` by shrinking backwards-from-the-end, and `validateGroup`
 * reports where it does not hold.
 */

/**
 * Bumped when the closure rules below change in a way that makes previously
 * stored group membership wrong. Recorded per membership row on the server so a
 * bad client rollout is identifiable, and recomputable, after the fact.
 */
export const CLOSURE_VERSION = 1;

export type PatchGroup = ReadonlySet<PatchId>;

/** Position in the patch chain: index into the chain order. */
type ChainPosition = number;
/** Index into `PatchSetIndex.sets`. */
type PatchSetOrdinal = number;

export type PatchSetIndex = {
  /**
   * One entry per patch set: its patch ids, deduplicated, oldest first.
   *
   * Note this is the *opposite* order from `SerializedPatchSet`, which is
   * newest-first throughout because the compare view renders newest-first. The
   * prefix invariant is only meaningful in chain order, so we flip once here
   * rather than reasoning about direction at every call site.
   */
  readonly sets: readonly (readonly PatchId[])[];
  /** Human-readable patch set path, for reporting. Parallel to `sets`. */
  readonly labels: readonly string[];
  readonly setsOf: ReadonlyMap<PatchId, readonly PatchSetOrdinal[]>;
  readonly chainPosition: ReadonlyMap<PatchId, ChainPosition>;
};

function positionOf(
  chainPosition: ReadonlyMap<PatchId, ChainPosition>,
  patchId: PatchId,
): ChainPosition {
  const position = chainPosition.get(patchId);
  if (position === undefined) {
    throw new Error(`Patch '${patchId}' is not in the chain order`);
  }
  return position;
}

export function patchSetLabel(
  moduleFilePath: string,
  patchPath: readonly string[],
): string {
  return patchPath.length > 0
    ? `${moduleFilePath}?${patchPath.join("/")}`
    : moduleFilePath;
}

/**
 * Turn a `SerializedPatchSet` into the chain-ordered form the closures need.
 *
 * `chainOrder` is the order patches are applied in — the order
 * `applicable/patches` returns them, which is the order `prepare()` applies
 * them in. Patches absent from every patch set (a patch carrying only `file` or
 * `test` ops, which `PatchSets.insert` skips) are still valid members of a
 * group; they simply constrain nothing.
 */
export function indexPatchSets(
  patchSets: SerializedPatchSet,
  chainOrder: readonly PatchId[],
): PatchSetIndex {
  const chainPosition = new Map<PatchId, ChainPosition>();
  chainOrder.forEach((patchId, i) => {
    chainPosition.set(patchId, i);
  });

  const sets: PatchId[][] = [];
  const labels: string[] = [];
  const setsOf = new Map<PatchId, PatchSetOrdinal[]>();

  for (const patchSet of patchSets) {
    const seen = new Set<PatchId>();
    for (const patch of patchSet.patches) {
      if (!chainPosition.has(patch.patchId)) {
        throw new Error(
          `Patch '${patch.patchId}' is in a patch set but not in the chain order. ` +
            `The chain order must contain every patch that was inserted.`,
        );
      }
      seen.add(patch.patchId);
    }
    const ordinal = sets.length;
    const ordered = Array.from(seen).sort(
      (a, b) => positionOf(chainPosition, a) - positionOf(chainPosition, b),
    );
    sets.push(ordered);
    labels.push(patchSetLabel(patchSet.moduleFilePath, patchSet.patchPath));
    for (const patchId of ordered) {
      const existing = setsOf.get(patchId);
      if (existing) {
        existing.push(ordinal);
      } else {
        setsOf.set(patchId, [ordinal]);
      }
    }
  }

  return { sets, labels, setsOf, chainPosition };
}

/**
 * Stage `requested` into `group`, pulling in whatever the prefix invariant
 * requires.
 *
 * For each patch set, everything up to the newest staged member joins the
 * group: those are the patches that already existed in that patch set when this
 * one was made. Patches added to the same patch set *afterwards* are not pulled
 * in — they come later in the chain, so the prefix is unaffected and the group
 * still applies. That asymmetry is the whole point: the second author to touch
 * a patch set inherits the first author's work, not the other way round.
 *
 * Iterated to a fixpoint because one patch can belong to two patch sets (a
 * `move` op inserts under both its destination and its source), so pulling a
 * patch into the group can extend the required prefix of another set.
 */
export function stageClosure(
  index: PatchSetIndex,
  group: PatchGroup,
  requested: Iterable<PatchId>,
): Set<PatchId> {
  const next = new Set(group);
  for (const patchId of requested) {
    next.add(patchId);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const set of index.sets) {
      let newestStaged = -1;
      for (let i = 0; i < set.length; i++) {
        if (next.has(set[i])) {
          newestStaged = i;
        }
      }
      for (let i = 0; i < newestStaged; i++) {
        if (!next.has(set[i])) {
          next.add(set[i]);
          changed = true;
        }
      }
    }
  }
  return next;
}

/**
 * Unstage `requested` from `group`, dropping whatever depends on it.
 *
 * The mirror of `stageClosure`: removing a patch removes everything *after* it
 * in each of its patch sets, since those were built on top of it. Predecessors
 * stay — they do not depend on what came after them.
 */
export function unstageClosure(
  index: PatchSetIndex,
  group: PatchGroup,
  requested: Iterable<PatchId>,
): Set<PatchId> {
  const doomed = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    for (const set of index.sets) {
      let oldestDoomed = -1;
      for (let i = set.length - 1; i >= 0; i--) {
        if (doomed.has(set[i])) {
          oldestDoomed = i;
        }
      }
      if (oldestDoomed < 0) {
        continue;
      }
      for (let i = oldestDoomed; i < set.length; i++) {
        if (!doomed.has(set[i])) {
          doomed.add(set[i]);
          changed = true;
        }
      }
    }
  }
  const next = new Set(group);
  for (const patchId of doomed) {
    next.delete(patchId);
  }
  return next;
}

export type PrefixViolation = {
  patchSet: string;
  /** Members of the patch set that are in the group, oldest first. */
  staged: PatchId[];
  /**
   * The holes: patches older than the newest staged member that are *not*
   * staged. A group is valid exactly when this is empty for every patch set.
   */
  missing: PatchId[];
};

/**
 * Check the prefix invariant.
 *
 * Worth running after *every* patch-set recomputation and not only after
 * stage/unstage, because patch sets coalesce: `PatchSets.insertPath` merges an
 * existing set into a new, broader one when the new patch's path is a prefix of
 * it. A third party's array insert can therefore merge two sets and turn a
 * previously valid group into one with a hole, without that group's owner
 * touching anything.
 */
export function validateGroup(
  index: PatchSetIndex,
  group: PatchGroup,
): PrefixViolation[] {
  const violations: PrefixViolation[] = [];
  index.sets.forEach((set, ordinal) => {
    const staged: PatchId[] = [];
    let newestStaged = -1;
    for (let i = 0; i < set.length; i++) {
      if (group.has(set[i])) {
        staged.push(set[i]);
        newestStaged = i;
      }
    }
    const missing: PatchId[] = [];
    for (let i = 0; i < newestStaged; i++) {
      if (!group.has(set[i])) {
        missing.push(set[i]);
      }
    }
    if (missing.length > 0) {
      violations.push({ patchSet: index.labels[ordinal], staged, missing });
    }
  });
  return violations;
}

/**
 * Repair policy for a group that a patch-set merge has invalidated.
 *
 * - `extend` grows the group so the user's own change stays publishable, at the
 *   cost of publishing a patch they did not choose.
 * - `truncate` shrinks it so nothing unexpected is published, at the cost of the
 *   user's own change silently leaving their group.
 *
 * `extend` is the default because the `truncate` failure is worse: the user hits
 * Publish, gets success, and their edit is not live. `extend` is at least
 * surfaceable — the pulled-in patches are reported so the UI can say whose work
 * came along.
 */
export type RepairPolicy = "extend" | "truncate";

export type GroupRepair = {
  group: Set<PatchId>;
  added: PatchId[];
  removed: PatchId[];
};

export function repairGroup(
  index: PatchSetIndex,
  group: PatchGroup,
  policy: RepairPolicy = "extend",
): GroupRepair {
  const violations = validateGroup(index, group);
  if (violations.length === 0) {
    return { group: new Set(group), added: [], removed: [] };
  }
  if (policy === "extend") {
    const repaired = stageClosure(index, group, group);
    const added: PatchId[] = [];
    for (const patchId of repaired) {
      if (!group.has(patchId)) {
        added.push(patchId);
      }
    }
    return { group: repaired, added, removed: [] };
  }
  // truncate: drop the tail of every violating patch set, i.e. everything from
  // the first hole onwards.
  const doomed = new Set<PatchId>();
  for (const violation of violations) {
    for (const patchId of violation.missing) {
      doomed.add(patchId);
    }
  }
  const repaired = unstageClosure(index, group, doomed);
  const removed: PatchId[] = [];
  for (const patchId of group) {
    if (!repaired.has(patchId)) {
      removed.push(patchId);
    }
  }
  return { group: repaired, added: [], removed };
}

/** The group's patches in chain order — the order they must be applied in. */
export function inChainOrder(
  index: PatchSetIndex,
  group: PatchGroup,
): PatchId[] {
  return Array.from(group).sort(
    (a, b) =>
      positionOf(index.chainPosition, a) - positionOf(index.chainPosition, b),
  );
}
