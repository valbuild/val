"use client";

import { Internal, VAL_PREVIEW_MESSAGES } from "@valbuild/core";
import {
  DEFAULT_CANVAS_SELECTION,
  holdKeys,
  isValCanvasStudioMessage,
  replayKeys,
  type HeldKeys,
  startInlineEditFirst,
  VAL_CANVAS_MESSAGE,
  type InlineEditing,
  type ValCanvasPageMessage,
} from "@valbuild/shared/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ValComponentControlsOff } from "./ValComponentEditorChrome";

/** Set on the tagged element under the pointer while picking is on. */
const HOVER_ATTRIBUTE = "data-val-preview-hover";

/**
 * EXPERIMENTAL: the preview route's side of its conversation with the Studio,
 * without the framework. `@valbuild/next` and `@valbuild/tanstack` each wrap it
 * with what a refresh means in their router.
 *
 * - **Refresh.** The Studio runs in the parent frame, so an edit is applied
 *   there and the preview has no way of knowing about it. The Studio posts a
 *   message, and this calls `onRefresh`, which reads the content again.
 * - **Size.** The Studio cannot see into the frame to measure it, so this
 *   reports how tall the component is whenever that changes, and the Studio
 *   sizes the frame to fit.
 * - **Pick.** Content read with stega carries its source path (Val tags the
 *   element with `data-val-path`), so a click on it says which field it came
 *   from. While the Studio has picking on - it is by default - a click on
 *   tagged content is sent to the Studio, which opens that field, instead of
 *   doing what it does on the site.
 * - **Typing in place.** In Content's Select & edit the Studio answers a pick
 *   of a text with the canvas's `editInline`, and this starts the edit as the
 *   canvas bridge does - the same `startInlineEditFirst`, the same messages
 *   back - so typing in a component's preview is typing on the page.
 * - **Colour.** The outlines are the project's selection colour, as the
 *   Studio says it (`theme`), and Val's green until it has.
 */
export function ValPreviewBridgeCore({
  onRefresh,
  children,
}: {
  onRefresh: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A ref, so a new `onRefresh` - a router can hand out a new one after every
  // refresh - does not re-subscribe and announce `ready` all over again.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  // On until the Studio says otherwise: it says so as soon as it hears `ready`.
  const [picking, setPicking] = useState(true);
  const [color, setColor] = useState(DEFAULT_CANVAS_SELECTION);
  const colorRef = useRef(color);
  colorRef.current = color;
  /** The text being typed in, from `editInline` until it ends. */
  const editing = useRef<InlineEditing | null>(null);
  /** The last pick: the element and where on it, for `editInline`. */
  const lastPick = useRef<{ element: Element; x: number; y: number } | null>(
    null,
  );
  /**
   * Whether a pick may be answered with `editInline` (the Studio's Select &
   * edit), and the keys typed while it is being asked: held, and typed into
   * the text once the edit has started, as the canvas bridge does - a
   * person types straight after the click, before the answer is back.
   */
  const editMode = useRef(false);
  const heldKeys = useRef<HeldKeys | null>(null);

  useEffect(() => {
    if (window.parent === window) {
      return;
    }
    const reply = (answer: ValCanvasPageMessage) =>
      window.parent.postMessage(answer, window.location.origin);
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data: unknown = event.data;
      if (isValCanvasStudioMessage(data)) {
        if (data.type === "editInline") {
          const keys = heldKeys.current?.release() ?? [];
          heldKeys.current = null;
          editing.current?.release();
          editing.current = null;
          const started = startInlineEditFirst(
            data.candidates,
            lastPick.current,
            { color: colorRef.current, reply },
          );
          if (started === null) {
            reply({
              val: VAL_CANVAS_MESSAGE,
              type: "inlineEditUnavailable",
              requestId: data.requestId,
            });
            return;
          }
          editing.current = started.editing;
          lastPick.current = null;
          reply({
            val: VAL_CANVAS_MESSAGE,
            type: "inlineEditStarted",
            requestId: data.requestId,
            path: started.path,
          });
          // What was typed while the Studio was being asked
          replayKeys(document, keys);
        } else if (data.type === "stopInlineEdit") {
          editing.current?.stop();
        }
        return;
      }
      if (typeof data !== "object" || data === null || !("type" in data)) {
        return;
      }
      if (data.type === VAL_PREVIEW_MESSAGES.refresh) {
        onRefreshRef.current();
      } else if (
        data.type === VAL_PREVIEW_MESSAGES.picking &&
        "enabled" in data &&
        typeof data.enabled === "boolean"
      ) {
        setPicking(data.enabled);
        editMode.current =
          "editing" in data && typeof data.editing === "boolean"
            ? data.editing
            : false;
      } else if (
        data.type === VAL_PREVIEW_MESSAGES.theme &&
        "selection" in data &&
        typeof data.selection === "string"
      ) {
        setColor(data.selection);
      }
    };
    window.addEventListener("message", listener);
    window.parent.postMessage(
      { type: VAL_PREVIEW_MESSAGES.ready },
      window.location.origin,
    );
    return () => {
      window.removeEventListener("message", listener);
      editing.current?.release();
      editing.current = null;
      heldKeys.current?.release();
      heldKeys.current = null;
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.parent === window) {
      return;
    }
    const post = () => {
      // The wrapper rather than the document: a layout that gives the body a
      // `min-height: 100vh` makes the document exactly as tall as the frame,
      // so measuring it could only ever confirm the frame's height and never
      // shrink it. Down to the wrapper's bottom edge, plus the body's own
      // margin below it, is everything the component takes up.
      const height =
        element.getBoundingClientRect().bottom +
        window.scrollY +
        (parseFloat(getComputedStyle(document.body).marginBottom) || 0);
      window.parent.postMessage(
        { type: VAL_PREVIEW_MESSAGES.size, height: Math.ceil(height) },
        window.location.origin,
      );
    };
    const observer = new ResizeObserver(post);
    observer.observe(element);
    post();
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!picking || window.parent === window) {
      // Select turned off: whatever was being typed in is done
      editing.current?.stop();
      heldKeys.current?.release();
      heldKeys.current = null;
      return;
    }
    let hovered: Element | null = null;
    const setHovered = (next: Element | null) => {
      hovered?.removeAttribute(HOVER_ATTRIBUTE);
      hovered = next;
      hovered?.setAttribute(HOVER_ATTRIBUTE, "");
    };
    const taggedAt = (target: EventTarget | null) =>
      target instanceof Element ? target.closest("[data-val-path]") : null;
    const onOver = (event: MouseEvent) => setHovered(taggedAt(event.target));
    const onLeave = () => setHovered(null);
    // Capture, so the component's own handlers - a link, a button - never
    // see a click that was a pick.
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      // A click in the text being typed in places the caret, and that is
      // all it does: neither a pick nor a click on the link it is in.
      const active = editing.current;
      if (
        active !== null &&
        active.isActive() &&
        target instanceof Element &&
        active.contains(target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const tagged = taggedAt(target);
      const attribute = tagged?.getAttribute("data-val-path");
      if (!tagged || !attribute) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      lastPick.current = {
        element: tagged,
        x: event.clientX,
        y: event.clientY,
      };
      if (editMode.current) {
        heldKeys.current?.release();
        heldKeys.current = holdKeys(window);
      }
      window.parent.postMessage(
        {
          type: VAL_PREVIEW_MESSAGES.pick,
          paths: Internal.splitJoinedSourcePaths(attribute),
        },
        window.location.origin,
      );
    };
    document.addEventListener("mouseover", onOver);
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      setHovered(null);
      document.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [picking]);

  // `flow-root` so the first and last child's margins stay inside the box
  // being measured, rather than collapsing through it.
  return (
    <div ref={ref} style={{ display: "flow-root" }}>
      {picking && (
        // The project's selection colour, as the canvas outlines in it
        <style>{`[${HOVER_ATTRIBUTE}] { outline: 2px solid ${color}; outline-offset: 2px; cursor: pointer; }`}</style>
      )}
      {/* One component, shown beside its fields: not a page to arrange */}
      <ValComponentControlsOff.Provider value={true}>
        {children}
      </ValComponentControlsOff.Provider>
    </div>
  );
}
