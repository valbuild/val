import { useCallback, useState } from "react";
import type { SourcePath } from "@valbuild/core";
import { CompareDialog } from "../compare/CompareDialog";
import { CompareValue } from "../compare/CompareValue";
import { useCompareModel } from "../compare/useCompareModel";
import type { SerializedPatchSet } from "../utils/PatchSets";

/**
 * The compare dialog, over what the review page is listing.
 *
 * A DIALOG rather than a route, and that is the relationship between the two
 * screens: the review page answers "what is going out" and is the thing you
 * decide over; the diff is a detail you open, read, and close — you come back
 * to the list, you do not navigate away from it.
 *
 * Mounted only while open. The model walks every changed path and renders a
 * field on both sides of each, so building it costs real work; a closed dialog
 * that had already paid for that would be paying it again on every edit.
 */
export function ReviewCompare({
  patchSets,
  mode,
  open,
  onOpenChange,
  currentAuthorId,
  onUndo,
}: {
  patchSets: SerializedPatchSet;
  mode: "fs" | "http" | "unknown";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAuthorId: string | null;
  /** Called with everything that will go — picks and their dependents. */
  onUndo: (rowIds: string[]) => void;
}) {
  if (!open) return null;
  return (
    <MountedCompare
      patchSets={patchSets}
      mode={mode}
      onOpenChange={onOpenChange}
      currentAuthorId={currentAuthorId}
      onUndo={onUndo}
    />
  );
}

function MountedCompare({
  patchSets,
  mode,
  onOpenChange,
  currentAuthorId,
  onUndo,
}: {
  patchSets: SerializedPatchSet;
  mode: "fs" | "http" | "unknown";
  onOpenChange: (open: boolean) => void;
  currentAuthorId: string | null;
  onUndo: (rowIds: string[]) => void;
}) {
  /*
   * Stable, because the model memoises on it. An inline arrow would be a new
   * function every render, so every render would rebuild every pane — on a
   * view whose panes each render a field on both sides.
   */
  const renderValue = useCallback(
    (path: SourcePath, side: "before" | "after") => (
      <CompareValue path={path} side={side} />
    ),
    [],
  );
  const model = useCompareModel({ patchSets, mode, renderValue });
  return (
    <CompareDialog
      open
      onOpenChange={onOpenChange}
      model={model}
      mode={mode}
      currentAuthorId={currentAuthorId}
      /*
       * Only `discard` reaches here: the dialog is opened over pending work,
       * so undoing one is dropping the patch. Restoring from a commit is the
       * other mechanic and lives on the history page — see `undoWords` for why
       * the two must not borrow each other's words.
       */
      onUndo={(_kind, rowIds) => onUndo(rowIds)}
    />
  );
}

/** Whether the dialog is open, for a page that owns the button. */
export function useCompareDialog(): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  show: () => void;
} {
  const [open, setOpen] = useState(false);
  return { open, onOpenChange: setOpen, show: () => setOpen(true) };
}
