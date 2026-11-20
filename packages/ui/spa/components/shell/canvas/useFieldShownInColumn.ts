import { useState } from "react";
import type { SourcePath } from "@valbuild/core";

/**
 * Which field the "On this page" column shows as the selected one.
 *
 * Usually the field the editor is on. But a text typed in ON the page (the
 * beta: `useCanvasInlineEdit`) is edited without the editor going anywhere,
 * so the column has to be told separately -- otherwise the caret is in a
 * headline and the column is still pointing at whatever was opened last,
 * three screens away.
 *
 * So the field being typed in wins, and KEEPS winning after the edit ends:
 * the row that was just edited going dark, and some other row lighting up
 * the moment Enter is pressed, reads as the edit having landed somewhere
 * else. It gives way when the editor itself moves -- a row opened in the
 * column, a search hit, a pick that opened a field the usual way -- because
 * that is someone saying where they are now.
 *
 * Both previous values are held in STATE, not refs, for the reason
 * `usePickingDefault` gives: a render React throws away must throw the
 * bookkeeping away with it.
 */
export function useFieldShownInColumn(
  /** The field the editor is on. */
  selected: SourcePath | null,
  /** The field being typed in on the page, while it is. */
  editing: SourcePath | null,
): SourcePath | null {
  const [edited, setEdited] = useState<SourcePath | null>(editing);
  const [seenEditing, setSeenEditing] = useState(editing);
  const [seenSelected, setSeenSelected] = useState(selected);
  let shown = edited;
  if (seenSelected !== selected) {
    setSeenSelected(selected);
    // The editor moved: unless something is being typed in right now, that
    // is where the column points.
    if (editing === null) {
      setEdited(null);
      shown = null;
    }
  }
  if (seenEditing !== editing) {
    setSeenEditing(editing);
    if (editing !== null) {
      setEdited(editing);
      shown = editing;
    }
  }
  return shown ?? selected;
}
