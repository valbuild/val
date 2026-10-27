/**
 * What a drag handle has to say about touch, for the browser to leave it alone.
 *
 * dnd-kit's touch sensor works by calling `preventDefault()` on `touchmove`.
 * That only works while the event is still cancelable, and it stops being
 * cancelable the moment the compositor has decided the gesture is a scroll —
 * which, on a real phone, it can decide before the main thread has run a single
 * listener. From then on the finger drags the LIST and the row at the same
 * time, and dnd-kit is left tracking a pointer whose coordinates no longer mean
 * what the measured rects mean.
 *
 * `touch-action: none` is how you tell the browser there is no gesture here to
 * take, so the decision never happens. It costs a scroll started exactly on the
 * grip, which is the trade dnd-kit's own docs make.
 *
 * NB: this has to be real CSS. It was `touch-action="manipulation"` written as
 * an HTML attribute on the row — React passes unknown attributes straight
 * through, so it rendered, and it did nothing at all.
 */
export const DRAG_HANDLE_TOUCH = "touch-none";

/**
 * The rest of a sortable row.
 *
 * `manipulation` keeps panning and pinching — the row is not a handle, and a
 * list you cannot scroll by dragging its rows is worse than a slow double tap —
 * while dropping the double-tap-to-zoom delay that otherwise sits in front of
 * every tap on it.
 */
export const SORTABLE_ROW_TOUCH = "touch-manipulation";
