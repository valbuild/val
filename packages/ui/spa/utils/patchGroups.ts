import { PatchId } from "@valbuild/core";
import { Operation } from "@valbuild/core/patch";
import { isInsidePatchSetPath, SerializedPatchSet } from "./PatchSets";

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

/*
 * WHY A GROUP IS NOT A BLANKET
 *
 * Why a group contains its owner's patches CLOSED OVER THEIR PATCH SETS, and
 * nothing else.
 *
 * The danger this has to answer is real, and it is worth stating before the rule.
 * The closure runs when a patch is *created* — which is after its author has
 * already picked a path. If Alice has inserted at `items/0` and that insert is not
 * in Bob's group, Bob sees `[A, B, C]` and picks index 1 for "B"; if his patch
 * then applies without her insert, index 1 is "A" and he has silently renamed the
 * wrong element. Staging later cannot fix a path chosen earlier.
 *
 * An earlier revision concluded from this that every group must hold every pending
 * patch. That was over-broad. What the danger actually requires is that a group
 * hold every pending patch that could SHIFT ITS OWN PATHS — and "the patches that
 * can shift each other's paths" is the definition of a patch set. Alice's insert
 * and Bob's rename both touch `?items`, so they are in one patch set and
 * {@link stageClosure} pulls her insert in. Bob is protected by the closure, not
 * by a blanket.
 *
 * Where a blanket and the closure differ is patches in DIFFERENT patch sets: Alice
 * edits `?title` while Bob edits `?items`. Bob's group excludes her title change,
 * and that cannot corrupt his op, because a different patch set means nothing that
 * shifts his paths. What it does mean is that Bob's view is `base + his own +
 * whatever the closure pulled in` — he does not see her title change until it is
 * published. Divergent views are accepted (§2.4); this is where they come from.
 *
 * Two consequences, both deliberate:
 *
 * - Publish is NOT what it was before patch groups. It ships your own work and
 *   what is entangled with it, not everything pending. That is the feature.
 * - Patch sets coalesce retroactively — `PatchSets.insertPath` merges an existing
 *   set into a broader one — so a group that was prefix-closed can stop being so
 *   through nobody's action. Nothing repairs that: a group grows when its owner
 *   writes and at no other time, so the hole stays and `publish` refuses the
 *   group until they stage what is missing or unstage what depends on it. Both
 *   automatic fixes decide silently what only that person can — see
 *   `PatchStagingProvider`.
 *
 * Independence then comes from **unstaging** as well: carve a patch set out of
 * your group and it leaves your view and your publish. The cost is that the
 * carved-out region becomes read-only for you until you re-stage
 * (`editWouldRestage`), because inside it your view and the published result
 * disagree — the same hole as above, entered deliberately.
 */
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
 * The part of an op that decides which patch sets it touches.
 *
 * Structural rather than `Operation` so a caller can ask about an edit it has not
 * built yet — the guard has to run before the patch exists.
 */
export type EditableOp = {
  op: Operation["op"];
  path: readonly string[];
  /** Set for `move` and `copy`, which touch two places. */
  from?: readonly string[];
};

export type HeldPatchSet = {
  patchSet: string;
  /** Pending patches in this patch set that are NOT in the group. */
  unstaged: PatchId[];
};

/**
 * Patch sets in which this group has left something unstaged.
 *
 * A held patch set is one where the author's view and the published result will
 * disagree: they see `base`, everyone else sees `base + the unstaged patch`. That
 * is fine as long as they only *look*. It stops being fine the moment they edit
 * there — see `editWouldRestage`.
 */
export function heldPatchSets(
  index: PatchSetIndex,
  group: PatchGroup,
): HeldPatchSet[] {
  const held: HeldPatchSet[] = [];
  index.sets.forEach((set, ordinal) => {
    const unstaged = set.filter((patchId) => !group.has(patchId));
    if (unstaged.length > 0) {
      held.push({ patchSet: index.labels[ordinal], unstaged });
    }
  });
  return held;
}

/**
 * Which unstaged patches an edit by `op` would drag back into the group.
 *
 * **This is a guard, not a convenience.** The prefix invariant says a group must
 * be prefix-closed, so an edit into a held patch set re-stages everything before
 * it. But the author picked their path — an array index, say — while looking at a
 * view that did *not* include those patches. Re-staging them shifts the content
 * under the path they just chose, and their edit silently lands somewhere else.
 *
 * Worked example (the scenario suite has it as an executable test): base
 * `[A, B, C]`, Bob inserts `New` at the top, Alice unstages it so her view is
 * `[A, B, C]`, Alice renames index 1 meaning `B` — and gets `[New, B*, B, C]`.
 * She renamed `A`. It applies cleanly and the prefix invariant holds; only the
 * content is wrong.
 *
 * So an edit for which this returns a non-empty list must be **refused**, and the
 * author asked to re-stage first. Re-staging updates their view, and only then can
 * they pick a path that means what they think it means. Rejecting an edit is
 * annoying; corrupting one silently is worse.
 *
 * The candidate keys mirror `PatchSets.insert`, because being coarser than it is
 * would block safe edits and being finer would miss unsafe ones:
 *
 * - `replace` keys on the op path itself, so that is the only candidate. Widening
 *   it to the parent would make a `replace` on a top-level field key the whole
 *   module, which contains every patch set — so holding anything anywhere would
 *   block every edit, and staging would be useless.
 * - `add`/`remove`/`move`/`copy` may widen to the parent (arrays do; records do
 *   not), so both the op path and its parent are candidates. That is the
 *   over-approximating half, and it is the safe direction.
 *
 * Containment is checked in both directions: the edit is unsafe whether it lands
 * inside a held patch set or is broad enough to swallow one.
 *
 * A `move` or `copy` touches two places, and `PatchSets` inserts it under both, so
 * `from` is checked as well. Taking the whole op rather than a path is what makes
 * that this function's job — leaving it to callers meant the source array of a move
 * out of a held region was silently unchecked.
 */
/**
 * NOT WIRED. The read-only guard this describes was considered and rejected.
 *
 * See "Editing inside a region you are holding back" in
 * `docs/independent-publish/DESIGN.md`: refusing an edit for a reason its author
 * cannot see is a worse everyday experience than the rare case it prevents, so
 * the held patches are loaded back in and the widened result is shown instead.
 *
 * Kept because it is the executable statement of the rule — `patchGroupScenario`
 * runs it, and a future design that does want to enforce it starts here rather
 * than from the prose.
 */
export function editWouldRestage(
  index: PatchSetIndex,
  group: PatchGroup,
  moduleFilePath: string,
  op: EditableOp,
): PatchId[] {
  const paths: (readonly string[])[] = [op.path];
  if ((op.op === "move" || op.op === "copy") && op.from) {
    paths.push(op.from);
  }
  const candidates: string[] = [];
  for (const path of paths) {
    candidates.push(patchSetLabel(moduleFilePath, path));
    if (op.op !== "replace" && path.length > 0) {
      candidates.push(patchSetLabel(moduleFilePath, path.slice(0, -1)));
    }
  }
  const restaged = new Set<PatchId>();
  for (const { patchSet, unstaged } of heldPatchSets(index, group)) {
    const overlaps = candidates.some(
      (candidate) =>
        candidate === patchSet ||
        isInsidePatchSetPath(candidate, patchSet) ||
        isInsidePatchSetPath(patchSet, candidate),
    );
    if (!overlaps) {
      continue;
    }
    for (const patchId of unstaged) {
      restaged.add(patchId);
    }
  }
  return Array.from(restaged).sort(
    (a, b) =>
      positionOf(index.chainPosition, a) - positionOf(index.chainPosition, b),
  );
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
