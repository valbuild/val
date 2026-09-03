import { useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { useValSystem } from "../stores/react/SystemContext";
import {
  useCurrentAuthorId,
  useOwnPatchGroupId,
  usePatchGroups,
} from "./ValProvider";

/**
 * This user's open patch group, and whether staging is available at all.
 *
 * Three states, and collapsing any two of them is a bug with a different
 * symptom each time:
 *
 * - `enabled: false` — this deployment has no patch groups. `fs` mode, a
 *   content API that predates them, or a lookup that failed. The staging
 *   controls stay off, which is what every project does today.
 * - `enabled: true` with a `patchGroupId` — this user has an open group, and
 *   `members` is what it holds.
 * - `enabled: true` with no `patchGroupId` — groups exist but this user has none
 *   yet. One is created by their first write (membership travels with the
 *   patch), so there is nothing to stage into until then.
 */
export type CurrentPatchGroup = {
  enabled: boolean;
  patchGroupId: string | undefined;
  members: ReadonlySet<PatchId>;
};

export function useCurrentPatchGroup(): CurrentPatchGroup {
  const groups = usePatchGroups();
  const authorId = useCurrentAuthorId();
  /*
   * What our own save was told, which the annotation may not know yet.
   *
   * A write names no group, so on a fresh branch the group is CREATED by the
   * save — and the chain annotation is only re-read when a fetch has missing
   * ids to ask for, which a patch this client made never is. Without this, the
   * tab that bootstrapped the group would never see its id and every stage
   * would silently do nothing.
   */
  const ownGroupId = useOwnPatchGroupId();
  return useMemo<CurrentPatchGroup>(() => {
    if (groups === undefined && ownGroupId === undefined) {
      return { enabled: false, patchGroupId: undefined, members: new Set() };
    }
    if (authorId === null) {
      /*
       * We do not know who this is yet — the profile has not loaded, or there
       * is no session. Matching the ANNOTATION anyway would compare
       * `null === null` and adopt a group whose author is null (an api-key or
       * PAT write), so this client would stage into, and publish, a stranger's
       * work.
       *
       * `ownGroupId` is not a match and is safe here: the server named it in
       * the answer to this client's own write, so it is ours by construction
       * rather than by comparing an author id we do not have.
       */
      return { enabled: true, patchGroupId: ownGroupId, members: new Set() };
    }
    const mine = groups?.find(
      (group: PatchGroupT) =>
        group.publishedAt === null &&
        group.authorId !== null &&
        group.authorId === authorId,
    );
    return {
      enabled: true,
      /*
       * The annotation wins where it has one. Both name the same group in the
       * steady state, but the annotation is the server's current answer while
       * `ownGroupId` is what a save said at some point — and a publish CLOSES a
       * group, so after one the annotation is right and the remembered id is
       * stale.
       */
      patchGroupId: mine?.patchGroupId ?? ownGroupId,
      members: new Set(mine?.patchIds ?? []),
    };
  }, [groups, authorId, ownGroupId]);
}

/**
 * The system, or null outside a provider.
 *
 * Re-exported so the staging wiring has one import for "everything I need to
 * change a group", rather than reaching into the store context directly at
 * three call sites.
 */
export { useValSystem };
