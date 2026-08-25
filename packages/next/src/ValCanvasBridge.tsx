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
export function ValCanvasBridge({ draftMode }: { draftMode: boolean }) {
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
    post({
      val: VAL_CANVAS_MESSAGE,
      type: "elements",
      elements,
      pageSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    });
  }, [post]);

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
      setHighlighted(message.path);
      if (message.path !== null && message.scrollIntoView) {
        const target = findByPath(message.path);
        target?.scrollIntoView({ block: "center", behavior: "smooth" });
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
            ? `[data-val-path] { outline: 1px solid rgba(99,102,241,0.35); outline-offset: 1px; cursor: pointer; }
[data-val-path]:hover { outline: 2px solid rgb(99,102,241); }`
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
  return `${selectors} { outline: 2px solid rgb(99,102,241); outline-offset: 1px; }`;
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
