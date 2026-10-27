import { draftModulePatches } from "./ValOps";
import type { CommitSha } from "./ValOps";
import type { ModuleFilePath, PatchId } from "@valbuild/core";

/**
 * Which patches a `jsonValues` entry renders in a draft: this module's
 * pending ones, and the ones published after the build that is reading.
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

test("every pending patch for the module applies", () => {
  const chain = [patch("theirs"), patch("mine")];
  expect(ids(draftModulePatches(chain, MODULE))).toEqual(["theirs", "mine"]);
});

test("another module's patches never apply here", () => {
  // The chain is branch-wide; this render is one module's.
  const chain = [patch("elsewhere", { path: OTHER_MODULE }), patch("mine")];
  expect(ids(draftModulePatches(chain, MODULE))).toEqual(["mine"]);
});

test("an applied patch is skipped without the commits that came after this build", () => {
  // A store that does not report them: every applied patch is in the build.
  const chain = [patch("shipped", { appliedAt: APPLIED })];
  expect(ids(draftModulePatches(chain, MODULE))).toEqual([]);
});

describe("with the commits content says came after this build", () => {
  /*
   * Content places every reader at its own build and returns the commits
   * after it. A patch applied at one of those was published after this build:
   * the build does not have it, so the draft must apply it. Skipping it showed
   * the old value from the publish until the next build went live.
   */
  const LATER = { commitSha: "later" as CommitSha };
  const commits = [{ commitSha: LATER.commitSha }];

  test("a patch published after this build is applied, in chain order", () => {
    const chain = [
      patch("theirs-pending"),
      patch("shipped-later", { appliedAt: LATER }),
      patch("mine"),
    ];
    expect(ids(draftModulePatches(chain, MODULE, commits))).toEqual([
      "theirs-pending",
      "shipped-later",
      "mine",
    ]);
  });

  test("and it is applied as pending: the build has none of it", () => {
    const chain = [patch("shipped-later", { appliedAt: LATER })];
    expect(
      draftModulePatches(chain, MODULE, commits).map((p) => p.appliedAt),
    ).toEqual([null]);
  });

  test("one applied at a commit this build already has is not applied twice", () => {
    // Content returns it only because it was named by id.
    const chain = [patch("shipped", { appliedAt: APPLIED }), patch("mine")];
    expect(ids(draftModulePatches(chain, MODULE, commits))).toEqual(["mine"]);
  });
});
