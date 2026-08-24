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
}) => Promise<PublishOutcome>;

export type PublishOutcome =
  | { status: "published" }
  | { status: "not-fast-forward"; message: string }
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
  | { status: "published"; patchIds: PatchId[] }
  | { status: "nothing-to-publish" }
  | {
      status: "refused";
      reason: "validation-errors";
      modules: ModuleFilePath[];
    }
  | { status: "refused"; reason: "already-publishing" }
  | {
      status: "failed";
      message: string;
      /** Per patch, where the server said which. */
      patchErrors?: Record<PatchId, string>;
      retryable: boolean;
    };
