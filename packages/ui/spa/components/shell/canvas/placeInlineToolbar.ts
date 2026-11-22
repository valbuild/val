/** A box in the Studio's viewport. */
export type ViewportBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** On the floating controls: a press inside them is not a press elsewhere. */
export const INLINE_TOOLBAR_ATTRIBUTE = "data-val-inline-toolbar";

/**
 * On the preview's controls that change only how the page is LOOKED at --
 * its zoom, its width, the window it is scrolled in -- and not which
 * document it is. A press on one does not end an edit on the page: someone
 * zooming in to see what they are typing is still typing it. See the press
 * listener in `CanvasFrame`.
 */
export const PREVIEW_VIEW_CONTROL_ATTRIBUTE = "data-val-preview-view-control";

/** What `CanvasFrame` says of the text being edited: see its `onInlineEditPlace`. */
export type InlineEditLocation = {
  /** The text's element, in the Studio's viewport. */
  field: ViewportBox;
  /** The caret in it, where the page could say. */
  caret: ViewportBox | null;
  /** The part of the preview that is on screen. */
  clip: ViewportBox;
};

/** Where the controls go, or that they are not shown at all. */
export type InlineToolbarPlace =
  | { shown: false }
  | {
      shown: true;
      top: number;
      left: number;
      /** Which of the three it ended up as: see {@link placeInlineToolbar}. */
      side: "above" | "below" | "inside";
    };

/** Between the controls and the text they belong to. */
const GAP = 8;
/** Between the controls and the edge of the preview. */
const MARGIN = 4;

/**
 * Where the formatting controls go for a richtext being typed in on the
 * page: above it, with its left edge.
 *
 * Above is where a person looks for them and is out of the way of what is
 * being typed. But above is not always there, and the controls are never
 * allowed outside the part of the preview that is on screen (`clip`) --
 * over the Studio's own column, or cut off by the pane's edge:
 *
 * - **above**, when the whole bar fits between the top of the preview and
 *   the text;
 * - **below** the text, when it does not: a richtext at the very top of the
 *   page, or scrolled until its first line is at the edge;
 * - **inside**, when neither fits -- a text taller than the preview, scrolled
 *   so both its ends are off screen. Then it is pinned to whichever edge of
 *   the preview is further from the caret, so it does not sit on the line
 *   being typed.
 *
 * And not at all while the text itself is scrolled out of the preview: the
 * controls of something that is not on screen would be controls of nothing.
 *
 * Sideways it keeps to the text's left edge, moved in as far as it takes to
 * stay inside the preview.
 */
export function placeInlineToolbar(
  field: ViewportBox,
  clip: ViewportBox,
  size: { width: number; height: number },
  caret: ViewportBox | null = null,
): InlineToolbarPlace {
  const clipBottom = clip.top + clip.height;
  const fieldBottom = field.top + field.height;
  if (fieldBottom <= clip.top || field.top >= clipBottom) {
    return { shown: false };
  }
  const minLeft = clip.left + MARGIN;
  const maxLeft = Math.max(
    minLeft,
    clip.left + clip.width - size.width - MARGIN,
  );
  const left = Math.min(Math.max(field.left, minLeft), maxLeft);

  const above = field.top - GAP - size.height;
  if (above >= clip.top + MARGIN) {
    return { shown: true, top: above, left, side: "above" };
  }
  const below = fieldBottom + GAP;
  if (below + size.height <= clipBottom - MARGIN) {
    return { shown: true, top: below, left, side: "below" };
  }
  const atTop = clip.top + MARGIN;
  const atBottom = Math.max(atTop, clipBottom - MARGIN - size.height);
  const caretMiddle =
    caret === null ? null : caret.top + caret.height / 2 - clip.top;
  const caretInUpperHalf =
    caretMiddle !== null && caretMiddle < clip.height / 2;
  return {
    shown: true,
    top: caretInUpperHalf ? atBottom : atTop,
    left,
    side: "inside",
  };
}
