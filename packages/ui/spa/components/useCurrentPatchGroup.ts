import { useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import type { PatchGroupT } from "@valbuild/shared/internal";
import { useValSystem } from "../stores/react/SystemContext";
import {
  useCurrentAuthorId,
  useOwnPatchGroupId,
  usePatchGroups,
  usePatchGroupsSupported,
} from "./ValProvider";

/**
 * This user's open patch group, and whether staging is available at all.
 *
 * Three states, and collapsing any two of them is a bug with a different
 * symptom each time:
 *
 * - `enabled: false` — there is no group to talk about. This deployment has
 *   none (`fs` mode, a content API that predates them, or a lookup that
 *   failed), or we do not yet know who the user is, so we cannot say which
 *   group is theirs. The staging controls stay off, which is what every
 *   project does today.
 * - `enabled: true` with a `patchGroupId` — this user has an open group, and
 *   `members` is what it holds.
 * - `enabled: true` with no `patchGroupId` — groups exist here but this user has
 *   none open. Before their first write on the branch, and again after every
 *   publish, since a publish closes the group and the next write creates the
 *   next one. Staging stays ON in this window: the review screen is usable, and
 *   `System.persistPatchGroupChange` holds what the user does there until there
 *   is a group to send it to.
 */
export type CurrentPatchGroup = {
  enabled: boolean;
  patchGroupId: string | undefined;
  members: ReadonlySet<PatchId>;
};

export function useCurrentPatchGroup(): CurrentPatchGroup {
  const groups = usePatchGroups();
  const supported = usePatchGroupsSupported();
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
    /*
     * Asked of the DEPLOYMENT, not of what we currently hold.
     *
     * This used to be `groups === undefined && ownGroupId === undefined`, which
     * is a different question with the same answer only until the first
     * publish. A publish closes the group, so the annotation stops carrying one
     * (it is absent, not empty, when no group holds anything) and
     * `markPublished` forgets the remembered id — and on a branch with a single
     * author both went unset at once. Staging disappeared from the review
     * screen and the write resolver was dropped, so every patch written between
     * that publish and the next page load joined no group and could not be
     * published as part of one. `patchGroupsSupported` latches instead.
     */
    if (!supported) {
      return { enabled: false, patchGroupId: undefined, members: new Set() };
    }
    if (authorId === null) {
      /*
       * We do not know who this is yet.
       *
       * `profileId` comes from `useStatus`'s own `/stat` poll; the annotation
       * comes from `GET /patches`. Two independent requests, either order. So
       * this branch is a RACE, not a steady state, and answering
       * `enabled: true` with no members made it a permanent one: the shell
       * seeds the scope from those empty members, `seedPatchGroup([])` scopes
       * the client to nothing, and the seed never runs again because the scope
       * is no longer `null`. The user's own pending patches from an earlier
       * session stay held for the life of the tab — base on screen, Publish
       * disabled, "N changes are held back".
       *
       * So: not enabled until we know whose group to ask for. Matching the
       * annotation anyway would be worse — `null === null` would adopt a group
       * whose author is null (an api-key or PAT write) and this client would
       * stage into, and publish, a stranger's work.
       *
       * `ownGroupId` is the exception and is safe: the server named it in the
       * answer to this client's OWN write, so it is ours by construction rather
       * than by comparing an author id we do not have.
       */
      return ownGroupId === undefined
        ? { enabled: false, patchGroupId: undefined, members: new Set() }
        : { enabled: true, patchGroupId: ownGroupId, members: new Set() };
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
  }, [groups, supported, authorId, ownGroupId]);
}

/**
 * The system, or null outside a provider.
 *
 * Re-exported so the staging wiring has one import for "everything I need to
 * change a group", rather than reaching into the store context directly at
 * three call sites.
 */
export { useValSystem };
