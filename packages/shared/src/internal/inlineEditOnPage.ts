import { Internal, type SourcePath } from "@valbuild/core";
import {
  startInlineEditing,
  type InlineEditCandidate,
  type InlineEditing,
} from "./inlineEditing";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
} from "./valCanvasProtocol";

/**
 * The page's half of starting an edit on it, for whatever answers the
 * Studio there: the canvas bridge in `@valbuild/next` and
 * `@valbuild/tanstack`, and the component preview route's bridge
 * (`ValPreviewBridgeCore` in `@valbuild/react`). One copy, so editing in a
 * component's preview is editing on the page, not a second way of it.
 */

/**
 * Start editing the first of `candidates` an element on the page shows and
 * nothing else: the picked element when it carries the candidate's path,
 * else the first element that does. `null` when none can be.
 *
 * What `editInline` does, and what a click does by itself when the Studio has
 * said ahead of it what the element's texts hold (`textFields`): one way to
 * start, whichever asked.
 */
export function startInlineEditFirst(
  candidates: readonly InlineEditCandidate[],
  pick: { element: Element; x: number; y: number } | null,
  options: {
    color: string;
    reply: (answer: ValCanvasPageMessage) => void;
  },
): { editing: InlineEditing; path: SourcePath } | null {
  const { reply } = options;
  for (const candidate of candidates) {
    const picked =
      pick !== null &&
      pick.element.isConnected &&
      valPathOn(pick.element, candidate.path) !== null
        ? pick.element
        : null;
    const element = picked ?? findElementByValPath(candidate.path);
    if (element === null) continue;
    const path = valPathOn(element, candidate.path);
    if (path === null) continue;
    const editing = startInlineEditing(element, candidate, {
      // Where the click was, when it was on this element.
      at: picked !== null && pick !== null ? { x: pick.x, y: pick.y } : null,
      color: options.color,
      onChange: (value) =>
        reply({
          val: VAL_CANVAS_MESSAGE,
          type: "inlineEdit",
          path,
          value,
        }),
      onEnd: () =>
        reply({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path }),
      onSelection: (selection, rect, caret) =>
        reply({
          val: VAL_CANVAS_MESSAGE,
          type: "inlineEditSelection",
          path,
          selection,
          rect,
          caret,
        }),
    });
    if (editing !== null) return { editing, path };
  }
  return null;
}

/** The first element on the page tagged with `path`, or `null`. */
export function findElementByValPath(path: string): Element | null {
  const elements = document.querySelectorAll("[data-val-path]");
  for (const el of Array.from(elements)) {
    if (valPathOn(el, path) !== null) return el;
  }
  return null;
}

/**
 * `path` as `element` carries it, or null when it does not.
 *
 * Compared as strings: the split returns branded `SourcePath`s and what came
 * back over `postMessage` is a plain string, which is the same value. What is
 * returned is the element's own, so it is a `SourcePath` without anyone
 * having to say so.
 */
export function valPathOn(element: Element, path: string): SourcePath | null {
  const attribute = element.getAttribute("data-val-path");
  if (!attribute) return null;
  return (
    Internal.splitJoinedSourcePaths(attribute).find(
      (candidate) => candidate === path,
    ) ?? null
  );
}
