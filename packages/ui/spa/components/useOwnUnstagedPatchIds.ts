import { useMemo } from "react";
import type { PatchId } from "@valbuild/core";
import {
  useChainVersion,
  useCurrentAuthorId,
  useGroupsVersion,
  useUnstagedPatchIds,
} from "./ValProvider";
import { useValSystem } from "../stores/react/SystemContext";

/**
 * The unstaged patches that are THIS user's, and therefore theirs to stage.
 *
 * `useUnstagedPatchIds` is branch-wide, and unstaging other people's work is the
 * NORMAL state on a shared branch — so anything that offers the reader an
 * action on an unstaged patch has to ask this instead. Publish told someone whose
 * own edits had netted out to nothing that "1 change is unstaged, so there is
 * nothing to publish. Stage it in Review to publish", about a colleague's
 * change they cannot publish and had no reason to stage — and the accurate
 * message about their own reverted work never appeared.
 *
 * A `null` author is a patch written by an api key or a PAT. Nobody owns it, so
 * it is nobody's to stage: the same reading `refuseUnlessOwn` gives on the
 * server, where `null === null` must not pass for ownership.
 *
 * In its own file rather than beside `useUnstagedPatchIds` so it can be tested the
 * way `useCurrentPatchGroup` is — a hook inside `ValProvider` cannot be reached
 * by a test that mocks `ValProvider`.
 */
export function useOwnUnstagedPatchIds(): ReadonlySet<PatchId> {
  const val = useValSystem();
  const unstaged = useUnstagedPatchIds();
  const authorId = useCurrentAuthorId();
  /*
   * Keyed on the VERSIONS, not only on `unstaged`'s identity.
   *
   * `PatchStore.unstagedPatchIds()` hands out `this.unstagedIds` itself — one Set,
   * mutated in place. `useUnstagedPatchIds` now copies it so its own result changes
   * identity when the content does, but this hook should not depend on a
   * caller-side invariant it cannot enforce: keyed on `unstaged` alone it computed
   * once and never again, and Publish went on offering to stage a change the
   * user had already staged.
   *
   * These are the same versions `useUnstagedPatchIds` keys on, so this recomputes
   * exactly when the unstaged set can have moved — not on every render.
   */
  const chainVersion = useChainVersion();
  const groupsVersion = useGroupsVersion();
  return useMemo(() => {
    void chainVersion;
    void groupsVersion;
    if (val === null || authorId === null || unstaged.size === 0) {
      return new Set<PatchId>();
    }
    const mine = new Set<PatchId>();
    for (const record of val.system.patchStore.recordsFor([...unstaged])) {
      if (record.authorId === authorId) {
        mine.add(record.patchId);
      }
    }
    return mine;
  }, [val, unstaged, authorId, chainVersion, groupsVersion]);
}
