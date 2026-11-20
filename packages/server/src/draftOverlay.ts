import type { ModuleFilePath, PatchId } from "@valbuild/core";
import type { ValCommit } from "@valbuild/shared/internal";
import type { CommitSha } from "./ValOps";

/**
 * The patches a json entry render should apply, out of the whole chain:
 *
 * 1. this module's, since the chain is branch-wide;
 * 2. a patch published after this build is kept: this build does not have it.
 *    One already in the build is dropped. `draftOverlay` decides which is
 *    which, from `commits`.
 */
export function draftModulePatches<
  T extends {
    path: ModuleFilePath;
    patchId: PatchId;
    appliedAt: { commitSha: CommitSha } | null;
  },
>(
  patches: T[],
  moduleFilePath: ModuleFilePath,
  /** The commits content says came after this build: see `draftOverlay`. */
  commits?: Pick<ValCommit, "commitSha">[],
): T[] {
  return draftOverlay(
    patches.filter((patch) => patch.path === moduleFilePath),
    commits,
  );
}

/**
 * The patches a DRAFT applies on top of this build's own source: the pending
 * ones, and the ones published AFTER this build, in chain order -- with
 * `appliedAt` cleared on the latter, because this build has none of them.
 *
 * Content places every caller at its own build (`getApplicablePatchesAndCommits`
 * in valbuild/home: "the earliest the caller has not seen") and returns the
 * commits after it as `commits`. A patch applied at one of those was
 * published after this build and is not in it, so a draft has to apply it --
 * skipping it showed the build's old value from the publish until the next
 * build went live. `/sources/~` already applies them (`getSources` walks every
 * patch it is given); the `.jsonValues()` entry path skipped them.
 *
 * A patch applied at a commit NOT in that list is already in this build --
 * content returns one only because it was asked for by id -- and is dropped:
 * applying it again would apply it twice. Without `commits` (a store that
 * does not report them) every applied patch is dropped, as before. Only
 * `ValOpsHttp` ever reports `appliedAt`; `fs` and memory stores report `null`.
 *
 * Chain order, not published-first, because that is the order the Studio
 * applies them in, and a draft page starts from the server's answer and is
 * then kept up to date by the Studio's: the two must agree.
 *
 * For the reads that render a draft only. What to COMMIT still keys on
 * `appliedAt`: a published patch must never be published again.
 */
export function draftOverlay<
  T extends { appliedAt: { commitSha: CommitSha } | null },
>(patches: T[], commits: Pick<ValCommit, "commitSha">[] | undefined): T[] {
  const afterThisBuild = new Set<string>(
    (commits ?? []).map((commit) => commit.commitSha),
  );
  const overlay: T[] = [];
  for (const patch of patches) {
    if (patch.appliedAt === null) {
      overlay.push(patch);
    } else if (afterThisBuild.has(patch.appliedAt.commitSha)) {
      overlay.push({ ...patch, appliedAt: null });
    }
  }
  return overlay;
}
