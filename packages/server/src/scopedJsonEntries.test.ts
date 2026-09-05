import { scopedModulePatches } from "./ValOps";
import type { CommitSha } from "./ValOps";
import type { ModuleFilePath, PatchId } from "@valbuild/core";

/**
 * Whose pending work a `jsonValues` entry renders.
 *
 * A draft page renders module content and `jsonValues` entries together, and
 * only the modules were scoped: `fetchVal` asked `/sources/~` for
 * `own_patch_groups_only`, while `loadDraftJsonEntry` asked `/json` with
 * `apply_patches: true` and no scoping at all. So one screen showed the
 * caller's own view for its modules and base plus EVERY pending patch on the
 * branch for the entries beside them — another author's half-finished edit,
 * rendered as though it were live.
 *
 * The sibling of `scopedPatches.test.ts`, which covers the same question for
 * `/sources/~`. The two rules differ in one respect on purpose, pinned below.
 */

const MODULE = "/content/settings.val.ts" as ModuleFilePath;
const OTHER_MODULE = "/content/page.val.ts" as ModuleFilePath;
const APPLIED = { commitSha: "abc123" as CommitSha };

function patch(
  patchId: string,
  over: { path?: ModuleFilePath; appliedAt?: typeof APPLIED | null } = {},
) {
  return {
    patchId: patchId as PatchId,
    path: over.path ?? MODULE,
    appliedAt: over.appliedAt ?? null,
  };
}

const ids = (list: { patchId: PatchId }[]) => list.map((p) => p.patchId);

test("unscoped keeps every pending patch for the module", () => {
  // `fs` mode, a content API without groups, or any caller that does not ask to
  // be scoped. This is the behaviour that must not change.
  const chain = [patch("theirs"), patch("mine")];
  expect(ids(scopedModulePatches(chain, MODULE, undefined))).toEqual([
    "theirs",
    "mine",
  ]);
});

test("a scoped render drops another author's pending patch", () => {
  // The bug. `theirs` is last in the chain, so unscoped it wins outright and
  // the reader sees a colleague's unpublished edit on their own draft page.
  const chain = [patch("mine"), patch("theirs")];
  expect(ids(scopedModulePatches(chain, MODULE, ["mine" as PatchId]))).toEqual([
    "mine",
  ]);
});

test("a scope holding NOTHING renders base, not everything", () => {
  /*
   * The trap that decided where this filter lives. Passing `[]` down to
   * `fetchPatches` would have meant "no filter" — both implementations read it
   * that way — so an author holding nothing back would have been shown every
   * unpublished patch on the branch instead of base.
   */
  const chain = [patch("mine"), patch("theirs")];
  expect(ids(scopedModulePatches(chain, MODULE, []))).toEqual([]);
});

test("another module's patches never apply here, scope or no scope", () => {
  // The chain is branch-wide; this render is one module's.
  const chain = [patch("elsewhere", { path: OTHER_MODULE }), patch("mine")];
  expect(ids(scopedModulePatches(chain, MODULE, undefined))).toEqual(["mine"]);
});

test("an applied patch is skipped even when the scope names it", () => {
  /*
   * Where this differs from `/sources/~`, deliberately: there, committed work
   * is unioned back in because it is nobody's to hold back. This path has
   * always skipped `appliedAt` patches, scope or no scope, and the scoping
   * change did not touch that — pinned so a later edit to the filter cannot
   * move it quietly.
   */
  const chain = [patch("shipped", { appliedAt: APPLIED })];
  expect(ids(scopedModulePatches(chain, MODULE, undefined))).toEqual([]);
  expect(
    ids(scopedModulePatches(chain, MODULE, ["shipped" as PatchId])),
  ).toEqual([]);
});
