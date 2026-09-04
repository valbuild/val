import type { ModuleFilePath, PatchId } from "@valbuild/core";

/**
 * Commit patches to the repository — `POST /save`.
 *
 * A seam like every other network path here, so the decision about WHEN to
 * publish is testable without a server. The result is a union rather than a
 * throw because each branch needs different handling and two of them are ordinary:
 *
 * - `published` — the patches are in the base now.
 * - `not-fast-forward` (409) — someone else committed first. Retryable after the
 *   client catches up, and distinct from a rejection for the same reason a patch
 *   conflict is: one must be retried and the other must not.
 * - `patch-errors` (400) — specific patches cannot be applied. Carried per patch
 *   id, because "Failed to publish" with no way to find the offending change is
 *   the thing the engine's own comment says it stopped doing. TS-AST-only failures
 *   reach the client ONLY here: the client applies patches to evaluated JSON and
 *   cannot see them.
 * - `error` / `network-error` — nothing is known.
 */
export type PublishPatches = (request: {
  patchIds: PatchId[];
  message?: string;
  /**
   * The patch group this publish EMPTIES, if it empties one.
   *
   * Sent on to the content API, which closes the group it names — and closes it
   * unconditionally, without checking that the commit shipped the whole thing.
   * So this is present only when the publish accounts for every patch the group
   * still holds; a partial publish sends nothing and leaves the group open with
   * the rest of its patches in it, which is what its owner is still working on.
   *
   * Without it the group is emptied by the commit and never closed: the id gets
   * reused across publishes instead of a new group per publish, and the
   * "already published" refusal can never fire.
   */
  closesPatchGroupId?: string;
  /**
   * The newest commit this client knew about when the publish was decided.
   *
   * Sent so the server can refuse a publish decided against a world somebody
   * else has since changed. See `expectedHeadCommitSha` in `ApiRoutes`.
   */
  expectedHeadCommitSha?: string;
}) => Promise<PublishOutcome>;

/**
 * How a caller wants a publish scoped.
 *
 * `exact` is auto-save's mode, and it exists because the two callers want
 * genuinely different things. A person clicking Save wants everything they can
 * see, and wants to be told if it moved under them. A timer firing while they
 * type wants the batch it named, expects the chain to keep growing, and must
 * never refuse just because it did — a save that refuses whenever someone is
 * typing is a save that never runs.
 *
 * What it does NOT relax is ordering: see `takeNamedPrefix`.
 */
export type PublishOptions = {
  exact?: boolean;
};

/**
 * An unpublished change the save threw away because it could not be applied.
 *
 * `fs` mode only. There, refusing the whole commit for one bad patch is a dead
 * stop rather than a refusal — the editor keeps typing and nothing is ever
 * written again — so the failing change and the rest of its module's chain go,
 * and this is how the studio finds out which.
 */
export type RemovedPatch = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  message: string;
};

export type PublishOutcome =
  | { status: "published"; removed?: RemovedPatch[] }
  | { status: "not-fast-forward"; message: string }
  /**
   * Somebody else published between this being decided and Save being clicked.
   *
   * Its own outcome rather than an error, because there is a specific thing to
   * do about it — look again — and because nothing was written. Distinct from
   * `not-fast-forward`, which is git refusing a commit; this is refused before
   * a commit is attempted, on a head the client named.
   */
  | { status: "head-moved"; message: string }
  | {
      status: "patch-errors";
      message: string;
      errors: Record<PatchId, string>;
    }
  | { status: "error"; message: string }
  | { status: "network-error"; message: string };

/** Throw patches away — `DELETE /patches`. */
export type DiscardPatches = (
  patchIds: PatchId[],
  /**
   * Which OTHER patches must lose their group membership because of this
   * delete.
   *
   * Deleting a patch out of the middle of a patch set leaves every group that
   * still holds the rest with a non-prefix intersection, and a prefix is the
   * one invariant a group has. Deriving which patches those are needs the
   * schema, so the client computes the forward closure and the content API
   * drops those memberships without deleting the patches.
   *
   * Passed as a second argument rather than folded into `patchIds`, because
   * they mean opposite things: the first list is deleted, the second is kept
   * and merely unstaged.
   */
  unstagePatchIds?: PatchId[],
) => Promise<
  | { status: "discarded"; patchIds: PatchId[] }
  | { status: "error"; message: string }
>;

/**
 * What a publish attempt did, from the caller's point of view.
 *
 * `refused` is its own outcome and not an error: a publish blocked by validation
 * errors is the system working. The modules are named so a UI can take the editor
 * to them rather than saying no.
 */
export type PublishResult =
  | { status: "published"; patchIds: PatchId[]; removed?: RemovedPatch[] }
  | { status: "nothing-to-publish" }
  | {
      status: "refused";
      reason: "validation-errors";
      modules: ModuleFilePath[];
    }
  | { status: "refused"; reason: "already-publishing" }
  /**
   * Local edits could not be saved, so the chain to publish is incomplete.
   *
   * A field writes on a pause in typing, so Save can arrive while the last word
   * is still only local. `publish` flushes first; this is the flush failing —
   * the server is unreachable or refused. Publishing anyway would ship the
   * project without the newest edit, which is the one the user is looking at.
   */
  | { status: "refused"; reason: "unsaved-changes"; patchIds: PatchId[] }
  /**
   * An edit landed while the gate was validating, so what was checked is not
   * what would be published.
   *
   * Retryable by re-running the gate — the caller clicks Save again. Kept
   * separate from `validation-errors` because nothing is wrong with the content:
   * the answer was simply about a document that has since moved.
   */
  | { status: "refused"; reason: "chain-moved" }
  /**
   * Somebody else published while this was being decided.
   *
   * Refused rather than failed, and the difference matters to the user: nothing
   * was written, and the thing to do is look at the review screen again — what
   * it showed was decided against a head that has since moved.
   */
  | { status: "refused"; reason: "head-moved" }
  | {
      status: "failed";
      message: string;
      /** Per patch, where the server said which. */
      patchErrors?: Record<PatchId, string>;
      retryable: boolean;
    };
