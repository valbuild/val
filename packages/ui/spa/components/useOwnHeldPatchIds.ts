import { useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import {
  useChainVersion,
  useCurrentAuthorId,
  useGroupsVersion,
  useHeldPatchIds,
} from "./ValProvider";
import { useValSystem } from "../stores/react/SystemContext";

/**
 * The held patches that are THIS user's, and therefore theirs to stage.
 *
 * `useHeldPatchIds` is branch-wide, and holding other people's work is the
 * NORMAL state on a shared branch — so anything that offers the reader an
 * action on a held patch has to ask this instead. Publish told someone whose
 * own edits had netted out to nothing that "1 change is held back, so there is
 * nothing to publish. Stage it in Review to publish", about a colleague's
 * change they cannot publish and had no reason to stage — and the accurate
 * message about their own reverted work never appeared.
 *
 * A `null` author is a patch written by an api key or a PAT. Nobody owns it, so
 * it is nobody's to stage: the same reading `refuseUnlessOwn` gives on the
 * server, where `null === null` must not pass for ownership.
 *
 * In its own file rather than beside `useHeldPatchIds` so it can be tested the
 * way `useCurrentPatchGroup` is — a hook inside `ValProvider` cannot be reached
 * by a test that mocks `ValProvider`.
 */
export function useOwnHeldPatchIds(): ReadonlySet<PatchId> {
  const val = useValSystem();
  const held = useHeldPatchIds();
  const authorId = useCurrentAuthorId();
  /*
   * Keyed on the VERSIONS, not only on `held`'s identity.
   *
   * `PatchStore.heldPatchIds()` hands out `this.heldIds` itself — one Set,
   * mutated in place. `useHeldPatchIds` now copies it so its own result changes
   * identity when the content does, but this hook should not depend on a
   * caller-side invariant it cannot enforce: keyed on `held` alone it computed
   * once and never again, and Publish went on offering to stage a change the
   * user had already staged.
   *
   * These are the same versions `useHeldPatchIds` keys on, so this recomputes
   * exactly when the held set can have moved — not on every render.
   */
  const chainVersion = useChainVersion();
  const groupsVersion = useGroupsVersion();
  return useMemo(() => {
    void chainVersion;
    void groupsVersion;
    if (val === null || authorId === null || held.size === 0) {
      return new Set<PatchId>();
    }
    const mine = new Set<PatchId>();
    for (const record of val.system.patchStore.recordsFor([...held])) {
      if (record.authorId === authorId) {
        mine.add(record.patchId);
      }
    }
    return mine;
  }, [val, held, authorId, chainVersion, groupsVersion]);
}
