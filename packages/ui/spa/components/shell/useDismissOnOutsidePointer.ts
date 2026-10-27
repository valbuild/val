import { RefObject, useEffect } from "react";

/**
 * Dismiss a popup when the next pointer press lands outside it.
 *
 * `composedPath()` rather than `event.target`, and that is the entire reason
 * this is shared rather than written inline three times.
 *
 * The studio renders inside a shadow root. An event listened for outside that
 * root — on `document` or `window` — has its `target` **retargeted to the
 * shadow host**, because the point of a shadow root is that the outside world
 * cannot see into it. So `container.contains(event.target)` asks "is the shadow
 * host inside this popup", which is false for every press, including a press on
 * the popup's own items. Each popup therefore dismissed itself on `pointerdown`
 * and unmounted before the `mousedown`/`click` that followed could be delivered
 * to the item that was pressed.
 *
 * That failure is nastier than it sounds, because the popup opens perfectly:
 * the caret shows the menu, the address bar shows its routes, the highlight
 * follows the mouse. Only the last step is missing, so it reads as "the button
 * does nothing" rather than as a dismissal — and `onMouseDown` instead of
 * `onClick`, which is the usual cure for a list that closes on blur, does not
 * help either, since `pointerdown` precedes `mousedown`.
 *
 * `composedPath()` is the path the event actually travelled, shadow boundaries
 * included, so a node inside the popup is in it whoever is listening.
 *
 * `pointerdown` rather than `click`, so a tap outside closes the popup before
 * the tap reaches the host page and activates something there.
 */
export function useDismissOnOutsidePointer(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const container = ref.current;
      if (container && event.composedPath().includes(container)) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [enabled, onDismiss, ref]);
}
