import type { PatchId } from "@valbuild/core";
import { selectionClosure } from "@valbuild/shared/internal";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { SavePatches } from "../history/restoreDestination";
import { callJson, StudioPublishError } from "../publish/publishClient";
import { z } from "zod";

/**
 * Publish selected (`docs/plans/remove-patch-groups.md`, Phase 4): the
 * changes picked in Review are published, and nothing else.
 *
 * With patch groups gone the site's Publish ships everything pending, and a
 * publish of part of the chain would ship a change while an earlier one stays
 * pending (rule 1). So the selection is moved off the site into a proposal of
 * its own -- kind `publish`, which no one opens -- and that proposal is
 * published at once, as any proposal is: the rest stays pending behind it.
 *
 * Three steps, each the one place its job is done:
 *
 * 1. **Saved here.** Content moves only changes it has.
 * 2. **Moved and saved there** (`POST /publish-selected`, the site's own Val
 *    server): prepared over the site's head and based on it, so a publish
 *    landing in between is refused rather than reverted.
 * 3. **Published** (`publishProposal`): the proposal's merge, its checks and
 *    press answered with what the merge moves, as at a proposal's address.
 */

/** What a selection publishes: whole patch sets, and who else's comes with it. */
export type SelectionPlan = {
  /** Every change that goes, in the order the patch sets list them. */
  patchIds: PatchId[];
  /** Of those, the ones that were not selected: they come with it. */
  added: PatchId[];
  /** Who wrote the ones that come with it, with no repeats. */
  addedAuthors: (string | null)[];
};

export function planSelection(
  patchSets: SerializedPatchSet,
  selected: readonly PatchId[],
): SelectionPlan {
  const order = patchSets.flatMap((set) =>
    set.patches.map((patch) => patch.patchId),
  );
  const patchIds = selectionClosure(patchSets, selected, [...new Set(order)]);
  const picked = new Set<string>(selected);
  const added = patchIds.filter((id) => !picked.has(id));
  const authorOf = new Map(
    patchSets.flatMap((set) =>
      set.patches.map((patch) => [patch.patchId, patch.author] as const),
    ),
  );
  return {
    patchIds,
    added,
    addedAuthors: [...new Set(added.map((id) => authorOf.get(id) ?? null))],
  };
}

/** How a Publish selected ended, as far as this half can say. */
export type PublishSelectedResult =
  /** Its proposal's merge is pressed: follow it as any proposal's publish. */
  | { status: "pressed"; proposal: string }
  | {
      status: "error";
      message: string;
      /**
       * The proposal its changes are in, when they got that far: they are
       * safe there, and it is where to finish publishing them.
       */
      proposal: string | null;
    };

/** The proposal the changes are in: on success, and on a 502 after the move. */
const Moved = z.object({ proposal: z.string() });

/** `POST /publish-selected` on this deployment's Val server. */
export function publishSelectedClient(options: {
  api: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.api.replace(/\/+$/, "")}/publish-selected`;
  return async (body: {
    patchIds: PatchId[];
    displayName: string;
    requestId: string;
  }): Promise<
    | { status: "moved"; proposal: string }
    | { status: "error"; message: string; proposal: string | null }
  > => {
    try {
      const answer = Moved.parse(await callJson(fetchImpl, url, "POST", body));
      return { status: "moved", proposal: answer.proposal };
    } catch (error) {
      const saved =
        error instanceof StudioPublishError
          ? Moved.safeParse(error.body)
          : null;
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        proposal: saved?.success ? saved.data.proposal : null,
      };
    }
  };
}

/**
 * The three steps, in order, stopping at the first that fails and saying how
 * far it got. `proposal` given: the changes are already in it (a Try again
 * after the move), so only the publish is pressed again.
 */
export async function runPublishSelected(deps: {
  save: SavePatches;
  move: ReturnType<typeof publishSelectedClient>;
  publish: (
    proposal: string,
  ) => Promise<
    | { status: "requested" | "handed-off" }
    | { status: "error"; message: string }
  >;
  patchIds: PatchId[];
  displayName: string;
  requestId: string;
  proposal?: string;
}): Promise<PublishSelectedResult> {
  let proposal = deps.proposal ?? null;
  if (proposal === null) {
    const saved = await deps.save(deps.patchIds);
    if (saved.status === "error") {
      return {
        status: "error",
        message: `Nothing was published: the changes are not saved yet. ${saved.message}`,
        proposal: null,
      };
    }
    const moved = await deps.move({
      patchIds: deps.patchIds,
      displayName: deps.displayName,
      requestId: deps.requestId,
    });
    if (moved.status === "error") return moved;
    proposal = moved.proposal;
  }
  const pressed = await deps.publish(proposal);
  if (pressed.status === "error") {
    return {
      status: "error",
      message: `The changes are in a proposal, and its publish could not start: ${pressed.message}`,
      proposal,
    };
  }
  return { status: "pressed", proposal };
}

/** "3 changes published on 17 Oct, 14:02": what the merged proposal is listed as. */
export function publishSelectedName(count: number, at: Date): string {
  const when = at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${count === 1 ? "1 change" : `${count} changes`} published on ${when}`;
}
