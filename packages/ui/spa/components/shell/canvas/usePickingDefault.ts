import { useState } from "react";
import { CanvasView } from "./types";

/**
 * Whether a click on the page selects what it hits.
 *
 * Its own state with its own button, not a consequence of the view. Each view
 * has an obvious default — the fields view exists to aim at things, the normal
 * view is the page as a visitor meets it, links and all — so switching views
 * sets it, and the button is how you disagree with the default. Deriving it
 * from the view outright meant the only way to point at something on the page
 * was to give up the module editor for the fields list, and no way at all to
 * read the page normally while still being able to select a piece of it.
 *
 * A hook of its own because getting the "adjust state when a prop changes"
 * pattern wrong here is invisible: the fields list still renders, the Select
 * button still draws, and the only symptom is that clicking the page reports
 * nothing — the canvas bridge only reports while picking.
 *
 * The previous view is held in STATE, not a ref. React is free to throw a
 * render away and start again from the last committed state — StrictMode does
 * it on every render — and a ref mutated during a discarded render survives
 * while the `setIsPicking` beside it does not. The retained pass then saw the
 * ref already equal to the new view, skipped the branch, and left picking off
 * for good. Two state updates cannot come apart that way: a discarded render
 * discards both, a committed one commits both.
 */
export function usePickingDefault(
  view: CanvasView,
): [boolean, (next: boolean) => void] {
  const [isPicking, setIsPicking] = useState(view === "fields");
  const [viewSource, setViewSource] = useState(view);
  if (viewSource !== view) {
    setViewSource(view);
    setIsPicking(view === "fields");
  }
  return [isPicking, setIsPicking];
}
