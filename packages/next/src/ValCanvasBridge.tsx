"use client";

import React from "react";
import { Internal } from "@valbuild/core";
import {
  isValCanvasStudioMessage,
  VAL_CANVAS_MESSAGE,
  ValCanvasElement,
  ValCanvasPageMessage,
} from "@valbuild/shared/internal";

/**
 * The colours Val outlines its content in.
 *
 * Literals, not the `--bg-page-selection` tokens they mirror: this runs inside
 * the customer's page, which has none of Val's stylesheet. If those tokens
 * change in `packages/ui/spa/index.css`, change these too.
 */
const SELECTION = "#079455";
const SELECTION_SOFT = "rgba(7, 148, 85, 0.4)";

/**
 * How often the page is re-measured even when nothing said it changed.
 *
 * A backstop, not the mechanism — the observers below carry the responsive
 * case. Slow enough to be free, fast enough that a field which appeared late is
 * in the list before anyone goes looking for it.
 */
const RESCAN_INTERVAL_MS = 5000;

/**
 * The page's half of the canvas protocol.
 *
 * Mounted only in the studio's canvas frame. Its job is to tell the studio
 * where Val's content is on the page, and to do the two things the studio can
 * ask of a document it cannot touch: outline an element, and treat a click as a
 * pick rather than as a click.
 *
 * Nothing here is visible on the customer's own site — this component is not
 * mounted there at all.
 */
export function ValCanvasBridge({
  draftMode,
  isRefreshing,
}: {
  draftMode: boolean;
  /**
   * Whether the server tree is being re-rendered because of an edit.
   *
   * Relayed to the studio so the canvas can say it is working. An edit updates
   * the client store at once but a server component only changes after a
   * `router.refresh()` and its round trip, which in development is long enough
   * that the canvas looked stuck rather than busy.
   */
  isRefreshing?: boolean;
}) {
  const [picking, setPicking] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  // Kept in a ref as well, because the capture-phase click listener below is
  // installed once and would otherwise close over the first value forever.
  const pickingRef = React.useRef(false);
  pickingRef.current = picking;

  const post = React.useCallback((message: ValCanvasPageMessage) => {
    // `*` as the target origin: the studio and the page share an origin today,
    // but the frame does not know the parent's origin for certain and naming
    // the wrong one silently drops the message. Nothing sent here is
    // sensitive — it is the positions of elements on a page the parent is
    // already displaying.
    window.parent.postMessage(message, "*");
  }, []);

  /**
   * The last payload posted, as a string.
   *
   * The periodic scan below runs whether or not anything moved, and an
   * unchanged payload costs the studio a re-render of the fields column for
   * nothing. Compared as a string because the comparison has to be by value —
   * every scan builds fresh objects.
   */
  const lastPosted = React.useRef<string | null>(null);

  /** Every element Val tagged, with where it is on the page. */
  const scan = React.useCallback(() => {
    const elements: ValCanvasElement[] = [];
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    document.querySelectorAll("[data-val-path]").forEach((el) => {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return;
      const attribute = el.getAttribute("data-val-path");
      if (!attribute) return;
      /**
       * A `<source>` has no box of its own, so its `<video>`/`<picture>` parent
       * is measured instead — the same substitution the overlay makes, and for
       * the same reason: an element with a zero-size rect cannot be pointed at.
       */
      let measured: Element = el;
      if (el.tagName === "SOURCE") {
        const parent = el.parentElement;
        if (
          parent &&
          (parent.tagName === "VIDEO" || parent.tagName === "PICTURE")
        ) {
          measured = parent;
        }
      }
      const rect = measured.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      elements.push({
        // Split by the same helper the rest of Val uses, so the studio gets
        // the paths back in exactly the form it holds them in.
        paths: Internal.splitJoinedSourcePaths(attribute),
        // Page coordinates, not viewport: the studio scales and offsets the
        // whole document, so a viewport-relative box would be wrong the moment
        // the frame scrolled.
        rect: {
          top: rect.top + scrollY,
          left: rect.left + scrollX,
          width: rect.width,
          height: rect.height,
        },
      });
    });
    const message: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "elements",
      elements,
      pageSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    };
    const serialized = JSON.stringify(message);
    if (serialized === lastPosted.current) {
      return;
    }
    lastPosted.current = serialized;
    post(message);
  }, [post]);

  // Relayed as it changes, not polled: the studio only has to know the two
  // edges, and a message per render would be a message per keystroke.
  React.useEffect(() => {
    post({
      val: VAL_CANVAS_MESSAGE,
      type: "refreshing",
      pending: isRefreshing === true,
    });
  }, [post, isRefreshing]);

  // Announce the frame, and say whether it is actually showing draft content.
  React.useEffect(() => {
    post({
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode,
      url: window.location.href,
    });
  }, [post, draftMode]);

  /**
   * Re-scan whenever the page could have moved.
   *
   * Coalesced into one animation frame: a layout change fires mutation,
   * resize and scroll events together, and scanning three times produces three
   * identical messages.
   */
  React.useEffect(() => {
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        scan();
      });
    };
    schedule();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-val-path", "class", "style"],
    });
    const resizes = new ResizeObserver(schedule);
    resizes.observe(document.documentElement);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Images and fonts land after the first paint and move everything below
    // them, so the boxes measured before `load` are stale by definition.
    window.addEventListener("load", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      mutations.disconnect();
      resizes.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("load", schedule);
    };
  }, [scan]);

  /**
   * And re-scan every few seconds regardless.
   *
   * The event-driven scan above is not enough in practice, and the way it fails
   * is confusing rather than obviously broken: the fields column shows some of
   * what is on the page and not the rest, until you happen to edit one of the
   * missing ones and they appear. Anything that tags content after the observers
   * are set up but produces no mutation they watch — a streamed-in server
   * component, an element that measured zero because its image had not decoded,
   * content revealed by something outside `data-val-path`, `class` and `style` —
   * is invisible until the next unrelated change. A slow poll costs nothing and
   * closes all of those at once, without having to guess which one it was.
   *
   * Idle-scheduled, and never on the frame's critical path. A scan is a
   * `querySelectorAll` plus a forced layout per tagged element, which is exactly
   * the kind of work that should wait for a gap rather than take one — and this
   * runs inside the customer's own page, where Val is a guest. Skipped entirely
   * while the frame is hidden, where the boxes cannot have moved and nobody is
   * looking at them.
   */
  React.useEffect(() => {
    let idle: number | null = null;
    const runWhenIdle = () => {
      if (document.hidden || idle !== null) return;
      // `requestIdleCallback` where it exists, a timeout where it does not
      // (Safari). The timeout option matters: without it a busy page can defer
      // an idle callback indefinitely, which is the one outcome worse than
      // scanning at a bad moment.
      if (typeof window.requestIdleCallback === "function") {
        idle = window.requestIdleCallback(
          () => {
            idle = null;
            scan();
          },
          { timeout: 1000 },
        );
      } else {
        idle = window.setTimeout(() => {
          idle = null;
          scan();
        }, 0);
      }
    };
    const interval = window.setInterval(runWhenIdle, RESCAN_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (idle === null) return;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle);
      }
    };
  }, [scan]);

  // What the studio asks for.
  React.useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (!isValCanvasStudioMessage(event.data)) return;
      const message = event.data;
      if (message.type === "rescan") {
        scan();
        return;
      }
      if (message.type === "setPicking") {
        setPicking(message.picking);
        return;
      }
      if (message.type === "sourceUpdate") {
        /**
         * Handed straight to the listener the page already has.
         *
         * `ValNextProvider` listens for this event on its own window to make an
         * inline edit visible behind the overlay; the only thing different here
         * is that the edit was made in another window. Re-dispatching rather
         * than reaching into the store keeps one path into the page — including
         * the `router.refresh()` it throttles behind it, which is what brings a
         * server component's own re-read across.
         */
        window.dispatchEvent(
          new CustomEvent("val-event", {
            detail: {
              type: "source-update",
              moduleFilePath: message.moduleFilePath,
              source: message.source,
            },
          }),
        );
        return;
      }
      if (message.type === "sourcesSynced") {
        // Relayed the same way and for the same reason as `sourceUpdate`: the
        // page is listening on its own window, and the studio is in another.
        window.dispatchEvent(
          new CustomEvent("val-event", {
            detail: { type: "sources-synced" },
          }),
        );
        return;
      }
      setHighlighted(message.path);
      if (message.path !== null && message.scrollIntoView) {
        const target = findByPath(message.path);
        // NOT `scrollIntoView` — see `scrollWithinPage`.
        if (target !== null) scrollWithinPage(target);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [scan]);

  /**
   * Picking.
   *
   * Capture phase, and the event is stopped: the point of picking mode is that
   * a click means "this one" rather than what the page would do with it, and a
   * link that navigates has taken the canvas somewhere else before the studio
   * hears anything.
   */
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!pickingRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const tagged = target.closest("[data-val-path]");
      const attribute = tagged?.getAttribute("data-val-path");
      if (!attribute) return;
      event.preventDefault();
      event.stopPropagation();
      post({
        val: VAL_CANVAS_MESSAGE,
        type: "clicked",
        paths: Internal.splitJoinedSourcePaths(attribute),
      });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, [post]);

  /**
   * Two-finger gestures, handed to the studio.
   *
   * The window around the page is the studio's, and the page is a frame: a
   * finger that lands here is this document's and the studio never hears about
   * it. So a pinch on the page could not zoom the window, which on a phone is
   * the only zoom there is — the toolbar's + and - are a poor substitute for the
   * gesture everyone already makes.
   *
   * Two fingers and only two. One finger is the page's: it scrolls it, taps its
   * links, drags whatever the page put there. Two are the window's, for zooming
   * and for moving the page around inside it. Nothing has to be moded, and the
   * two cannot be confused for one another.
   *
   * `passive: false` because both handlers cancel: the default for two fingers
   * is the browser's own page zoom, which inside a frame the studio is already
   * scaling produces two zooms fighting over one gesture.
   */
  React.useEffect(() => {
    const midpoint = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const span = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    /**
     * Whether a gesture is in progress.
     *
     * `touchend` fires per finger, so lifting one of two leaves a `touchend`
     * carrying a single touch — which is the end of the gesture — and the
     * second leaves one carrying none. Without this the second would post a
     * second `end` for a gesture that was already over.
     */
    let active = false;
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      active = true;
      post({
        val: VAL_CANVAS_MESSAGE,
        type: "pinch",
        phase: "start",
        span: span(event.touches),
        center: midpoint(event.touches),
      });
    };
    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !active) return;
      event.preventDefault();
      post({
        val: VAL_CANVAS_MESSAGE,
        type: "pinch",
        phase: "move",
        span: span(event.touches),
        center: midpoint(event.touches),
      });
    };
    const onEnd = (event: TouchEvent) => {
      if (!active || event.touches.length >= 2) return;
      active = false;
      post({
        val: VAL_CANVAS_MESSAGE,
        type: "pinch",
        phase: "end",
        span: 0,
        center: { x: 0, y: 0 },
      });
    };
    document.addEventListener("touchstart", onStart, { passive: false });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [post]);

  /**
   * And ctrl/cmd + wheel, which is what a trackpad pinch reports as.
   *
   * The same problem as touches and the same answer: the wheel event lands on
   * this document, so without relaying it a trackpad pinch over the page does
   * nothing while the identical gesture over the canvas background zooms.
   *
   * A PLAIN wheel is deliberately left alone — that is the page scrolling
   * itself, which is exactly what it should do.
   */
  React.useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      post({
        val: VAL_CANVAS_MESSAGE,
        type: "zoom",
        // The same response curve the studio uses for a wheel on its own
        // background, so the gesture feels the same on both sides of the frame.
        factor: 1 - event.deltaY / 300,
        center: { x: event.clientX, y: event.clientY },
      });
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    return () => document.removeEventListener("wheel", onWheel);
  }, [post]);

  /**
   * The outlines, as a stylesheet rather than as injected elements.
   *
   * A style rule cannot disturb the page's layout, which an absolutely
   * positioned box on top of it eventually would — and the whole value of
   * showing the real page is that it is laid out the way the customer built
   * it. `outline` rather than `border` for the same reason: outlines do not
   * take up space.
   */
  return (
    <style
      // The attribute selector is built from the path, so it is escaped as a
      // CSS string. A path contains quotes (`?p="/"`) and would otherwise
      // close the selector early.
      dangerouslySetInnerHTML={{
        __html: [
          picking
            ? `[data-val-path] { outline: 1px solid ${SELECTION_SOFT}; outline-offset: 1px; cursor: pointer; }
[data-val-path]:hover { outline: 2px solid ${SELECTION}; }`
            : "",
          highlighted ? highlightRule(highlighted) : "",
        ]
          .filter(Boolean)
          .join("\n"),
      }}
    />
  );
}

/**
 * A rule that outlines exactly the elements carrying `path`.
 *
 * The attribute holds a comma-separated list, so this cannot be one `=`
 * comparison; and it cannot be a `*=` substring test either, because a path is
 * a prefix of every path below it. `?p="/blogs/blog1"` is contained in
 * `?p="/blogs/blog1"."title"`, so a substring test on the route would outline
 * every field on the page — which is what it did.
 *
 * Four selectors instead: the whole attribute, the first item, the last item,
 * and one in the middle. Between them they match the path as a complete list
 * item and nothing else.
 */
function highlightRule(path: string): string {
  const value = JSON.stringify(path);
  const inner = JSON.stringify(`,${path},`);
  const first = JSON.stringify(`${path},`);
  const last = JSON.stringify(`,${path}`);
  const selectors = [
    `[data-val-path=${value}]`,
    `[data-val-path^=${first}]`,
    `[data-val-path$=${last}]`,
    `[data-val-path*=${inner}]`,
  ].join(",\n");
  return `${selectors} { outline: 2px solid ${SELECTION}; outline-offset: 1px; }`;
}

/**
 * Bring an element into view WITHOUT scrolling anything outside this page.
 *
 * `Element.scrollIntoView` would be the obvious thing, and it is the thing that
 * broke the studio. It scrolls every scroll container between the element and
 * the viewport, and for a same-origin frame that chain does not stop at the
 * frame: it continues into the embedder and scrolls the studio's own containers
 * too. Measured in Chromium — with the studio's phone panes placed on the
 * editor, a single `scrollIntoView` in here pulls them back onto the canvas, and
 * because it reveals the element rather than the frame it can leave them
 * anywhere in between, showing half of each.
 *
 * That is not a thing the page has any business doing. It was asked to show one
 * of its own elements; where the studio is looking is the studio's affair. So
 * the scrolling is done by hand, one scrollport at a time, and the walk stops at
 * this document.
 *
 * Only the document centres the target vertically — it is being pointed out,
 * and something flush against the top edge of the fold does not read as pointed
 * out. Every scrollport inside the page is moved as little as it takes to bring
 * the target inside it: a carousel, a sticky sidebar or a sideways-scrolling
 * table is showing what it is showing on purpose, and re-centring one that did
 * not need moving is the page rearranging itself around a highlight.
 */
function scrollWithinPage(target: Element): void {
  let node = target.parentElement;
  while (node !== null) {
    const isRoot = node === document.body || node === document.documentElement;
    if (isRoot) break;
    if (isScrollable(node)) {
      const port = node.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      node.scrollTop += delta(
        box.top - port.top,
        box.height,
        node.clientHeight,
        false,
      );
      node.scrollLeft += delta(
        box.left - port.left,
        box.width,
        node.clientWidth,
        false,
      );
    }
    node = node.parentElement;
  }
  // And this document, which is the last scrollport there is as far as the page
  // is concerned. `window`, not `documentElement.scrollIntoView`-by-another-name:
  // this cannot reach past the frame.
  const box = target.getBoundingClientRect();
  window.scrollTo({
    top: Math.max(
      0,
      window.scrollY + delta(box.top, box.height, window.innerHeight, true),
    ),
    left: Math.max(
      0,
      window.scrollX + delta(box.left, box.width, window.innerWidth, false),
    ),
    behavior: "smooth",
  });
}

/**
 * How far a scrollport has to move for `size` at `offset` to be shown.
 *
 * `center` asks for the middle of the port; without it the answer is zero
 * whenever the thing is already inside, which is what keeps a scrollport that
 * did not need moving from being disturbed.
 */
function delta(
  offset: number,
  size: number,
  port: number,
  center: boolean,
): number {
  if (center) return offset - (port - size) / 2;
  if (offset < 0) return offset;
  if (offset + size > port) return Math.min(offset, offset + size - port);
  return 0;
}

/** Whether this element scrolls its own content, rather than growing with it. */
function isScrollable(el: Element): boolean {
  const style = getComputedStyle(el);
  const scrolls = (value: string) =>
    value === "auto" || value === "scroll" || value === "overlay";
  return (
    (scrolls(style.overflowY) && el.scrollHeight > el.clientHeight) ||
    (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth)
  );
}

function findByPath(path: string): Element | null {
  const elements = document.querySelectorAll("[data-val-path]");
  for (const el of Array.from(elements)) {
    const attribute = el.getAttribute("data-val-path");
    if (!attribute) continue;
    // Compared as strings: the split returns branded `SourcePath`s and what
    // came back over `postMessage` is a plain string, which is the same value.
    if (
      Internal.splitJoinedSourcePaths(attribute).some(
        (candidate) => candidate === path,
      )
    ) {
      return el;
    }
  }
  return null;
}
