import { useCallback } from "react";
import {
  useCurrentAuthorId,
  useDeletePatches,
  usePatchSets,
  useValMode,
} from "../components/ValProvider";
import { usePatchStaging } from "../components/PatchStagingProvider";
import type { SerializedPatchSet } from "../utils/PatchSets";
import { ReviewView } from "./ReviewView";
import { useReviewModel } from "./useReviewModel";
import { reviewRowId, reviewSourcePath } from "./toReviewModel";
import { ReviewCompare, useCompareDialog } from "./ReviewCompare";

/**
 * `/val/review`, wired up.
 *
 * The seam between the page and the system, and it is thin by design: the page
 * renders a `ReviewModel` and nothing else, so everything here is either
 * gathering (`useReviewModel`) or turning a row id back into the patches it
 * stands for.
 *
 * That last part is the only real work. A row IS a patch set — the unit
 * staging moves and a revert removes — but the controls speak in patch ids, so
 * every action maps its selection back through the patch sets it came from.
 * Keyed by `reviewRowId`, which is the patch set's own path rather than any
 * patch id in it: a set coalesces as more edits land on the same path, so "the
 * id of its first patch" names a different set an edit later and a tick would
 * silently move to another row.
 *
 * Mounted under `PatchStagingProvider` by the caller. Without it every row
 * answers "staged", both sections collapse into one, and Stage does nothing —
 * which is why `stagingEnabled` is on the model rather than assumed.
 */
export function ReviewSurface({
  patchSets,
  onRestore,
  onDiscardAll,
  discardAllDescription,
  portalContainer,
}: {
  patchSets: SerializedPatchSet;
  /** Absent where there is no published history to restore from. */
  onRestore?: () => void;
  /** Absent where there is nothing a revert could take back. */
  onDiscardAll?: () => void;
  discardAllDescription?: string;
  portalContainer?: HTMLElement | null;
}) {
  const model = useReviewModel(patchSets);
  const staging = usePatchStaging();
  const mode = useValMode();
  const currentAuthorId = useCurrentAuthorId();
  const { deletePatches } = useDeletePatches();
  /*
   * The diff opens OVER this page rather than navigating to one. It is a
   * detail you read and close — you come back to the list you were deciding
   * over — and a route would take the list off screen to show you part of it.
   */
  const compare = useCompareDialog();

  const patchIdsOf = useCallback(
    (rowIds: string[]) => {
      const wanted = new Set(rowIds);
      return patchSets
        .filter((patchSet) => wanted.has(reviewRowId(patchSet)))
        .flatMap((patchSet) => patchSet.patches.map((patch) => patch.patchId));
    },
    [patchSets],
  );
  /*
   * The dialog's row ids are SOURCE paths, not patch-set ids — its rows are
   * finer than this page's. A patch set is dropped when the path it changed is
   * among them, which is the same unit a discard can honour: the prefix
   * invariant means a patch out of the middle of a set cannot go alone.
   */
  const patchIdsOfPaths = useCallback(
    (paths: string[]) => {
      const wanted = new Set(paths);
      return patchSets
        .filter((patchSet) => wanted.has(reviewSourcePath(patchSet)))
        .flatMap((patchSet) => patchSet.patches.map((patch) => patch.patchId));
    },
    [patchSets],
  );

  return (
    <>
      <ReviewView
        model={model}
        onCompare={compare.show}
        onRestore={onRestore}
        onStage={(rowIds) => staging.stage(patchIdsOf(rowIds))}
        onUnstage={(rowIds) => staging.unstage(patchIdsOf(rowIds))}
        /*
         * Reverting a staged change deletes the patch. That is what `discard`
         * MEANS at this layer — see `undoWords` for why the button says
         * "Revert" — and it is the one action here that destroys something,
         * which is why it is the only red control on the page.
         */
        onDiscard={(rowIds) => deletePatches(patchIdsOf(rowIds))}
        onDiscardAll={onDiscardAll}
        discardAllDescription={discardAllDescription}
        portalContainer={portalContainer}
      />
      <ReviewCompare
        patchSets={patchSets}
        mode={mode}
        open={compare.open}
        onOpenChange={compare.onOpenChange}
        currentAuthorId={currentAuthorId}
        /*
         * The dialog's rows are source paths; the patches behind them are what
         * a discard drops. Same mapping the page's own Revert does, one level
         * down: the dialog is finer-grained, so it names paths rather than
         * patch sets.
         */
        onUndo={(rowIds) => deletePatches(patchIdsOfPaths(rowIds))}
      />
    </>
  );
}

/** The patch sets, or the reason there are none to show. */
export function ReviewLoader({
  children,
}: {
  children: (patchSets: SerializedPatchSet) => React.ReactNode;
}) {
  const result = usePatchSets();
  if (result.status === "not-asked") {
    return (
      <div className="py-8 text-center text-sm text-fg-tertiary">
        Reading what is pending…
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="py-8 text-center text-sm text-fg-error-on-surface">
        Failed to load changes: {result.error}
      </div>
    );
  }
  return <>{children(result.data)}</>;
}
