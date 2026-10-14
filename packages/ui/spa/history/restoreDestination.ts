import type { PatchId } from "@valbuild/core";

/**
 * Where a restore goes once it is written.
 *
 * `here`: into this Studio's pending changes, reviewed and published with
 * everything else -- in a proposal, that is the proposal; on a project with
 * no proposals, it is the site.
 *
 * `proposal`: on the site of a project with proposals, a restore OPENS one
 * (valbuild/home `docs/hosted-publishing.md`, step 9). Its patches are written
 * on the site like any edit, then moved into a new proposal as it is created
 * -- content's `POST /proposals` with `patchIds`, which moves pending changes
 * or refuses all of them -- and the Studio goes there. So a restore is never
 * published to the site without being looked at in a proposal first.
 */
export type RestoreDestination =
  | { kind: "here" }
  | {
      kind: "proposal";
      /**
       * Create the proposal with these changes moved in, and go to it.
       * Throws when it could not; resolves once the page is navigating.
       * `requestId` makes it idempotent: sent again, the same proposal.
       */
      open: (input: {
        displayName: string;
        patchIds: PatchId[];
        requestId: string;
      }) => Promise<void>;
    };

/** What became of a restore after its patches were written. */
export type LandResult =
  | { status: "staged" }
  /** Its proposal is open and the page is going there. */
  | { status: "opening" }
  | { status: "error"; message: string };

/** Make sure these patches are on the server, or say why they are not. */
export type SavePatches = (
  patchIds: readonly PatchId[],
) => Promise<{ status: "ok" } | { status: "error"; message: string }>;

/**
 * The proposal's name for a restore from a commit: what was restored, from
 * when, in words a list of proposals can show.
 */
export function restoreProposalName(
  createdAt: string,
  what: "point" | "everything" | "one",
): string {
  const at = new Date(createdAt);
  const when = Number.isNaN(at.getTime())
    ? createdAt
    : at.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
  switch (what) {
    case "point":
      return `Back to ${when}`;
    case "everything":
      return `Put back as it was on ${when}`;
    case "one":
      return `Restore from ${when}`;
  }
}

/**
 * Hand written patches to where the restore goes.
 *
 * For a proposal: saved first, because content moves only changes it has --
 * a patch still in this tab's queue would be refused as unknown -- and the
 * request id is taken from the patches, so pressing Try again after a lost
 * answer opens the proposal the first press made rather than a second one.
 */
export async function landRestore(deps: {
  destination: RestoreDestination;
  save: SavePatches;
  patchIds: PatchId[];
  displayName: string;
}): Promise<LandResult> {
  const { destination, patchIds } = deps;
  if (destination.kind === "here" || patchIds.length === 0) {
    return { status: "staged" };
  }
  const saved = await deps.save(patchIds);
  if (saved.status === "error") {
    return {
      status: "error",
      message: `The restore is written but not saved yet, so no proposal was opened: ${saved.message}`,
    };
  }
  try {
    await destination.open({
      displayName: deps.displayName,
      patchIds,
      requestId: restoreRequestId(patchIds),
    });
    return { status: "opening" };
  } catch (error) {
    return {
      status: "error",
      message: `The restore is written, but a proposal for it could not be opened: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** One per restore, the same on a retry: content's create is keyed by it. */
export function restoreRequestId(patchIds: readonly PatchId[]): string {
  return `restore-${[...patchIds].sort()[0]}`.slice(0, 100);
}
