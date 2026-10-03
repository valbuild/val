import type { Api } from "@valbuild/shared/internal";
import type { z } from "zod";
import type { StatSnapshot } from "../StatStore";

/**
 * What the stores take from a `/stat` answer read OUTSIDE the provider's poll:
 * the re-sync after a parent conflict.
 *
 * Its own function so nothing the provider's intake carries is dropped here.
 * `schemaSha` was: a conflict is often how a client first meets a server that
 * has moved — a deploy whose websocket message it missed — and in websocket
 * mode the next poll can be twenty minutes away, so the reload prompt waited
 * that long while the editor kept writing against the old schema.
 */
export function statSnapshotOf(json: StatResponseJson): StatSnapshot {
  return {
    baseSha: json.baseSha,
    sourcesSha: json.sourcesSha,
    schemaSha: json.schemaSha,
    patches: json.patches,
    appliedPatches: json.appliedPatches,
    headCommitSha: json.headCommitSha,
    // The new head is the whole point of a re-sync: a conflict means the
    // parent we named was not it. `fs` answers without one.
    headPatchId: "headPatchId" in json ? json.headPatchId : undefined,
    headVersion: "headVersion" in json ? json.headVersion : undefined,
    // Drained by the server as it answers (`fs` mode), so dropped here they
    // are lost: nobody is told their unpublished work was removed.
    ...("removed" in json && json.removed !== undefined
      ? { removed: json.removed }
      : {}),
  };
}

/** The 200 body of `/stat`. */
export type StatResponseJson = Extract<
  z.infer<Api["/stat"]["POST"]["res"]>,
  { status: 200 }
>["json"];
