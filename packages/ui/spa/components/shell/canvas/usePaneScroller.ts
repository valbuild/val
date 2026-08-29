import { RefObject, useCallback, useEffect, useRef, useState } from "react";

/** Which half of the workspace a phone is showing. */
export type WorkspacePane = "editor" | "canvas";

/**
 * How long the panes have to be still before their position means anything.
 *
 * A scroll — anybody's — is a stream of events, and the only one worth reading
 * is the last. Short enough that a correction is never seen as a second
 * animation, long enough to sit out a momentum flick's tail.
 */
const SETTLE_MS = 120;

/**
 * How far off a pane boundary counts as being on it.
 *
 * Not zero: a scroll offset is a fraction on a device with a fractional pixel
 * ratio, and rubber-banding on iOS leaves one behind on purpose. An exact
 * comparison would find a deviation on every scroll and correct a container
 * that is already exactly where it should be, forever.
 */
const ON_PANE_PX = 1;

export type PaneScroller = {
  /** Goes on the element that scrolls between the panes. */
  ref: RefObject<HTMLDivElement | null>;
  /** Which pane is current. */
  pane: WorkspacePane;
  /**
   * Show a pane, and keep showing it.
   *
   * `animate` is about this placement only; the invariant is the same either
   * way. Left out, a placement glides once one has already been made — the
   * first one is where the panes START, and nothing should be seen sliding
   * into a position it was always in.
   */
  goTo: (pane: WorkspacePane, options?: { animate?: boolean }) => void;
};

/**
 * The phone's two panes, and the one rule that keeps them whole.
 *
 * ## The rule
 *
 * **Whenever the panes have been still for {@link SETTLE_MS}, the scroller is
 * exactly on a pane** — the one the person swiped to if they were swiping, and
 * otherwise the one {@link PaneScroller.goTo} last asked for. There is no third
 * outcome, and no window of time in which there is.
 *
 * That is the whole hook, and it is stated as an invariant rather than as a
 * sequence of steps on purpose: the failure it exists to prevent is not one bug
 * but a shape of bug, and the shape is always the same — something other than
 * this component moves the scroller, and nothing puts it back.
 *
 * ## What moves it
 *
 * The canvas pane holds an iframe on the customer's site, and a browser scrolls
 * a scroll container for reasons that have nothing to do with whoever wrote it:
 *
 * - Focusing an element scrolls every ancestor scroller to reveal it, and
 *   clicking inside an iframe focuses the iframe.
 * - `scrollIntoView` **inside a same-origin frame walks out of the frame** and
 *   scrolls the embedder's scrollers too. Measured, not assumed: with the panes
 *   placed on the editor, one `scrollIntoView` in the framed page pulls them
 *   back onto the canvas. (`ValCanvasBridge` no longer calls it — see there —
 *   but that fix lives in a different package, shipped separately, and this one
 *   must hold against an older page.)
 * - A scroll-snap container re-snaps to the area it last considered current
 *   whenever its contents change, and the editor pane's contents change
 *   constantly as fields resolve.
 * - `scrollTo` from the browser's own UI: find-in-page, an anchor, a
 *   restoration on rotate.
 *
 * The version of this that held the position for 400ms after each placement
 * covered the first three when they were quick and none of them when they were
 * not — and what it left behind when it lost was a scroller resting BETWEEN the
 * panes, showing half of each. Nothing recovered from that: the switch reads
 * the position back, agreed with the half it was nearest, found the state it
 * already had, and changed nothing. The panes then stayed split until the
 * canvas was closed, through any number of navigations.
 *
 * So: no window, no deadline, no counting of the ways it can be moved. It is
 * put back every time it comes to rest anywhere else.
 *
 * ## Why the pane lives here
 *
 * Because it and the scroll position are the same fact, and the split version
 * of that fact is exactly what got stuck: the state said "editor", the
 * scroller said "somewhere between", and each was consistent with itself.
 *
 * ## What it does not try to do
 *
 * Tell a swipe from a browser scroll that happens to coincide with a finger
 * being down somewhere on the panes. Nothing distinguishes them, and it does
 * not matter: both branches of the rule end with the scroller exactly on a
 * pane, so the worst such a coincidence can produce is the wrong pane — which
 * one swipe undoes — rather than no pane, which nothing undid.
 */
export function usePaneScroller({
  enabled,
  paneCount,
  animate,
}: {
  /** Off where there are no panes to scroll — every layout but the phone. */
  enabled: boolean;
  /** How many panes exist. One while the canvas is closed. */
  paneCount: number;
  /** Whether a placement may glide. Off for reduced motion and for tests. */
  animate: boolean;
}): PaneScroller {
  const ref = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<WorkspacePane>("editor");

  /**
   * The current pane, readable from a listener.
   *
   * Written next to every `setPane` rather than in an effect: the settle below
   * runs on a timer and must see the pane that has been ASKED for, not the one
   * the last render happened to commit.
   */
  const paneRef = useRef(pane);
  const paneCountRef = useRef(paneCount);
  paneCountRef.current = paneCount;
  const animateRef = useRef(animate);
  animateRef.current = animate;

  /**
   * Whether the person is moving the panes themselves.
   *
   * The one thing that makes the scroller's position an ANSWER rather than a
   * deviation, so it is set as narrowly as it can be: a pointer has to be down
   * ON the scroller AND the scroller has to actually move while it is. A tap
   * scrolls nothing, and neither does a click on a field in the editor column —
   * so neither leaves the scroller willing to adopt whatever moves it next,
   * which is the whole failure this hook exists to prevent.
   */
  const userDriven = useRef(false);
  /** Whether a pointer is down on the scroller. See {@link userDriven}. */
  const pointerDown = useRef(false);
  /** Whether a pane has ever been placed. See {@link PaneScroller.goTo}. */
  const hasPlaced = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const offsetOf = useCallback(
    (container: HTMLElement, target: WorkspacePane) =>
      target === "canvas" && paneCountRef.current > 1
        ? container.clientWidth
        : 0,
    [],
  );

  /**
   * Which pane the scroller is nearest.
   *
   * Rounded rather than compared against the half-way mark, so it says the same
   * thing for two panes as it would for five — and so a scroller resting a
   * third of the way across resolves to a pane rather than to an argument.
   */
  const nearestPane = useCallback((container: HTMLElement): WorkspacePane => {
    if (paneCountRef.current < 2 || container.clientWidth === 0)
      return "editor";
    return Math.round(container.scrollLeft / container.clientWidth) >= 1
      ? "canvas"
      : "editor";
  }, []);

  /** Put the scroller exactly on `target`. */
  const place = useCallback(
    (target: WorkspacePane, smooth: boolean) => {
      const container = ref.current;
      if (container === null || container.clientWidth === 0) return;
      const left = offsetOf(container, target);
      if (smooth) {
        container.scrollTo({ left, behavior: "smooth" });
        return;
      }
      container.scrollTo({ left, behavior: "auto" });
      // Asserted as well as asked for: a snap container mid-gesture can decline
      // a `scrollTo`, and this one has to land.
      if (Math.abs(container.scrollLeft - left) > ON_PANE_PX) {
        container.scrollLeft = left;
      }
    },
    [offsetOf],
  );

  /**
   * The invariant, applied.
   *
   * Runs when the panes have been still for {@link SETTLE_MS}, and is the only
   * thing that ever changes the pane in response to a position.
   */
  const settle = useCallback(() => {
    settleTimer.current = null;
    const container = ref.current;
    // Nothing to hold in place, and no size to hold it at. The observer below
    // brings it back the moment there is one.
    if (container === null || container.clientWidth === 0) return;
    const wasUserDriven = userDriven.current;
    userDriven.current = false;
    const target = wasUserDriven ? nearestPane(container) : paneRef.current;
    if (target !== paneRef.current) {
      paneRef.current = target;
      setPane(target);
    }
    const left = offsetOf(container, target);
    if (Math.abs(container.scrollLeft - left) > ON_PANE_PX) {
      // Never smooth: this is a correction, not a move. Something else already
      // put the scroller somewhere it should not be, and animating back from
      // there draws attention to a position nobody chose.
      container.scrollLeft = left;
    }
  }, [nearestPane, offsetOf]);

  const armSettle = useCallback(() => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, SETTLE_MS);
  }, [settle]);

  const goTo = useCallback<PaneScroller["goTo"]>(
    (target, options) => {
      const smooth =
        options?.animate ?? (animateRef.current && hasPlaced.current);
      hasPlaced.current = true;
      // A placement is this component speaking, so whatever gesture the
      // scroller thought it was in the middle of is over.
      userDriven.current = false;
      pointerDown.current = false;
      if (target !== paneRef.current) {
        paneRef.current = target;
        setPane(target);
      }
      place(target, smooth);
      // Even a placement that moved nothing arms the settle: it is what proves
      // the scroller ended up where it was told, and a `scrollTo` that the
      // browser quietly declined produces no scroll event to notice.
      armSettle();
    },
    [place, armSettle],
  );

  /**
   * Every scroll re-arms the settle, and nothing else reads the position.
   *
   * Deliberately indifferent to who scrolled and why. A gesture, a momentum
   * tail, a glide of our own, a browser revealing a focused frame — they all
   * produce the same stream of events, and the only question worth asking is
   * what the position is once they stop.
   */
  useEffect(() => {
    if (!enabled) return;
    const container = ref.current;
    if (container === null) return;
    /**
     * A scroll while a finger is down is the person moving the panes.
     *
     * The two halves have to be taken separately. A pointer alone is not a
     * choice — most of them are taps and clicks on things inside the panes — and
     * a scroll alone is not one either, since that is exactly what the browser
     * does when it reveals a focused frame. Together they are.
     */
    const onScroll = () => {
      if (pointerDown.current) userDriven.current = true;
      armSettle();
    };
    const onPointerDown = () => {
      pointerDown.current = true;
    };
    /**
     * And the end of one, whether or not anything moved.
     *
     * A settle is armed here as well because a tap produces no scroll at all,
     * and the flag it leaves down has to be cleared by something.
     */
    const onPointerUp = () => {
      pointerDown.current = false;
      armSettle();
    };
    // A wheel IS the gesture, with no pointer to be down: a trackpad swipe
    // across the panes arrives as nothing else.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaX !== 0) userDriven.current = true;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("touchstart", onPointerDown, { passive: true });
    container.addEventListener("touchend", onPointerUp, { passive: true });
    container.addEventListener("touchcancel", onPointerUp, { passive: true });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("touchstart", onPointerDown);
      container.removeEventListener("touchend", onPointerUp);
      container.removeEventListener("touchcancel", onPointerUp);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, [enabled, armSettle]);

  /**
   * A pane offset is a width, so a resize moves it.
   *
   * Rotating a phone changes `clientWidth` and leaves the scroller on the old
   * pane's old offset, which is the same split view by another route. Also
   * covers the first size the container ever has: on mount it is measured at
   * zero, where there is nothing to place.
   */
  useEffect(() => {
    if (!enabled) return;
    const container = ref.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => place(paneRef.current, false));
    observer.observe(container);
    place(paneRef.current, false);
    return () => observer.disconnect();
  }, [enabled, place]);

  /**
   * The canvas closing takes its pane with it.
   *
   * Not merely a placement: with one pane there is no canvas to be on, so the
   * pane the switch reports has to come back too.
   */
  useEffect(() => {
    if (!enabled) return;
    if (paneCount > 1) {
      place(paneRef.current, false);
      return;
    }
    if (paneRef.current !== "editor") {
      paneRef.current = "editor";
      setPane("editor");
    }
    place("editor", false);
  }, [enabled, paneCount, place]);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );

  return { ref, pane, goTo };
}
