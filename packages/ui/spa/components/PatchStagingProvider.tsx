import { PatchId } from "@valbuild/core";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from "react";
import { SerializedPatchSet } from "../utils/PatchSets";
import {
  CLOSURE_VERSION,
  heldPatchSets,
  inChainOrder,
  indexPatchSets,
  PatchGroup,
  stageClosure,
  unstageClosure,
} from "../utils/patchGroups";

/**
 * Staging state for the compare view.
 *
 * The provider owns the patch group and the closure rules; the rows stay
 * presentational and ask questions like "is this row staged" and "what else moves
 * if I toggle it". Keeping the rules here rather than in the rows means there is
 * one place where the prefix invariant is maintained, and it is the same code the
 * scenario suite tests (`utils/patchGroups.ts`).
 *
 * A group holds every pending patch by default — see `DEFAULT_GROUP_IS_EVERYTHING`
 * — so with staging untouched the UI behaves exactly as it did before: everything
 * is staged, Publish publishes everything.
 */

export type RowStagingState =
  /** Every patch behind this row is staged. */
  | "staged"
  /** None of them are. The row will not publish and is not in your preview. */
  | "held"
  /**
   * Some are and some are not. Only reachable transiently — a patch set is the
   * unit of staging, but a compare-view row can span more than one patch set (a
   * module-level row, say), so a mixed state has to be representable.
   */
  | "partial";

export type PatchStaging = {
  /**
   * False when the server cannot store groups (FS mode, or a content API that
   * predates patch groups). The UI hides the affordance entirely rather than
   * offering a control that silently does nothing.
   */
  enabled: boolean;
  stateOf: (patchIds: readonly PatchId[]) => RowStagingState;
  /** What staging these would additionally pull in, in chain order. */
  stagePreview: (patchIds: readonly PatchId[]) => PatchId[];
  /** What unstaging these would additionally drop, in chain order. */
  unstagePreview: (patchIds: readonly PatchId[]) => PatchId[];
  stage: (patchIds: readonly PatchId[]) => void;
  unstage: (patchIds: readonly PatchId[]) => void;
  /** Patch sets this group is holding back, for the "held" summary. */
  held: { patchSet: string; unstaged: PatchId[] }[];
  group: PatchGroup;
  /** Author of a patch, for "also publishes Bob's change" copy. */
  authorOf: (patchId: PatchId) => string | null;
};

const noopStaging: PatchStaging = {
  enabled: false,
  stateOf: () => "staged",
  stagePreview: () => [],
  unstagePreview: () => [],
  stage: () => {},
  unstage: () => {},
  held: [],
  group: new Set(),
  authorOf: () => null,
};

const PatchStagingContext = createContext<PatchStaging>(noopStaging);

export function usePatchStaging(): PatchStaging {
  return useContext(PatchStagingContext);
}

export function PatchStagingProvider({
  enabled,
  patchSets,
  chainOrder,
  group,
  onChange,
  children,
}: {
  enabled: boolean;
  patchSets: SerializedPatchSet;
  /**
   * Every pending patch id, oldest first. This is the order patches are applied
   * in, and the prefix invariant is only meaningful in it — so it is a required
   * input rather than something derived from `patchSets`, whose own ordering is
   * newest-first for display.
   */
  chainOrder: readonly PatchId[];
  group: PatchGroup;
  onChange: (next: Set<PatchId>, change: PatchGroupChange) => void;
  children: ReactNode;
}) {
  const index = useMemo(
    () => indexPatchSets(patchSets, chainOrder),
    [patchSets, chainOrder],
  );

  const authors = useMemo(() => {
    const byId = new Map<PatchId, string | null>();
    for (const patchSet of patchSets) {
      for (const patch of patchSet.patches) {
        byId.set(patch.patchId, patch.author);
      }
    }
    return byId;
  }, [patchSets]);

  const stateOf = useCallback(
    (patchIds: readonly PatchId[]): RowStagingState => {
      if (patchIds.length === 0) {
        return "staged";
      }
      const staged = patchIds.filter((id) => group.has(id)).length;
      if (staged === patchIds.length) {
        return "staged";
      }
      return staged === 0 ? "held" : "partial";
    },
    [group],
  );

  const stagePreview = useCallback(
    (patchIds: readonly PatchId[]) => {
      const next = stageClosure(index, group, patchIds);
      return inChainOrder(
        index,
        new Set(
          Array.from(next).filter(
            (id) => !group.has(id) && !patchIds.includes(id),
          ),
        ),
      );
    },
    [index, group],
  );

  const unstagePreview = useCallback(
    (patchIds: readonly PatchId[]) => {
      const next = unstageClosure(index, group, patchIds);
      return inChainOrder(
        index,
        new Set(
          Array.from(group).filter(
            (id) => !next.has(id) && !patchIds.includes(id),
          ),
        ),
      );
    },
    [index, group],
  );

  const stage = useCallback(
    (patchIds: readonly PatchId[]) => {
      const next = stageClosure(index, group, patchIds);
      onChange(next, {
        type: "stage",
        requested: Array.from(patchIds),
        alsoMoved: stagePreview(patchIds),
        closureVersion: CLOSURE_VERSION,
      });
    },
    [index, group, onChange, stagePreview],
  );

  const unstage = useCallback(
    (patchIds: readonly PatchId[]) => {
      const next = unstageClosure(index, group, patchIds);
      onChange(next, {
        type: "unstage",
        requested: Array.from(patchIds),
        alsoMoved: unstagePreview(patchIds),
        closureVersion: CLOSURE_VERSION,
      });
    },
    [index, group, onChange, unstagePreview],
  );

  const value = useMemo(
    (): PatchStaging => ({
      enabled,
      stateOf,
      stagePreview,
      unstagePreview,
      stage,
      unstage,
      held: heldPatchSets(index, group),
      group,
      authorOf: (patchId) => authors.get(patchId) ?? null,
    }),
    [
      enabled,
      stateOf,
      stagePreview,
      unstagePreview,
      stage,
      unstage,
      index,
      group,
      authors,
    ],
  );

  return (
    <PatchStagingContext.Provider value={value}>
      {children}
    </PatchStagingContext.Provider>
  );
}

export type PatchGroupChange = {
  type: "stage" | "unstage";
  /** What the user asked for. */
  requested: PatchId[];
  /** What the closure moved along with it. Non-empty means the UI must explain. */
  alsoMoved: PatchId[];
  /**
   * Which revision of the closure rules produced `alsoMoved`. Sent on to the
   * server and stored per membership row, so a bad client rollout stays
   * identifiable — and recomputable — after the fact.
   */
  closureVersion: number;
};
