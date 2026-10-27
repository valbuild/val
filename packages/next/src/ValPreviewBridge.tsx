"use client";

import { Internal, VAL_PREVIEW_MESSAGES } from "@valbuild/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_CANVAS_SELECTION } from "@valbuild/shared/client";

/** Set on the tagged element under the pointer while picking is on. */
const HOVER_ATTRIBUTE = "data-val-preview-hover";

/**
 * EXPERIMENTAL: the preview route's side of its conversation with the Studio.
 * Wrap what `unstable_renderValComponent` returns in it.
 *
 * - **Refresh.** The Studio runs in the parent frame, so an edit is applied
 *   there and the preview has no way of knowing about it. The Studio posts a
 *   message, and this turns it into a `router.refresh()`, which re-runs the
 *   Server Component with the new content.
 * - **Size.** The Studio cannot see into the frame to measure it, so this
 *   reports how tall the component is whenever that changes, and the Studio
 *   sizes the frame to fit.
 * - **Pick.** Content read with stega carries its source path (Val tags the
 *   element with `data-val-path`), so a click on it says which field it came
 *   from. While the Studio has picking on - it is by default - a click on
 *   tagged content is sent to the Studio, which opens that field, instead of
 *   doing what it does on the site.
 *
 * @example
 * // app/val-preview/page.tsx
 * return (
 *   <ValPreviewBridge>
 *     {await unstable_renderValComponent({ valModules, sourcePath, fetchVal })}
 *   </ValPreviewBridge>
 * );
 */
export function ValPreviewBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  // A ref, so a refresh - after which `useRouter` can hand out a new object -
  // does not re-subscribe and announce `ready` all over again.
  const routerRef = useRef(router);
  routerRef.current = router;
  const ref = useRef<HTMLDivElement>(null);
  // On until the Studio says otherwise: it says so as soon as it hears `ready`.
  const [picking, setPicking] = useState(true);

  useEffect(() => {
    if (window.parent === window) {
      return;
    }
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === VAL_PREVIEW_MESSAGES.refresh) {
        routerRef.current.refresh();
      } else if (
        event.data?.type === VAL_PREVIEW_MESSAGES.picking &&
        typeof event.data.enabled === "boolean"
      ) {
        setPicking(event.data.enabled);
      }
    };
    window.addEventListener("message", listener);
    window.parent.postMessage(
      { type: VAL_PREVIEW_MESSAGES.ready },
      window.location.origin,
    );
    return () => {
      window.removeEventListener("message", listener);
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
      const attribute = taggedAt(event.target)?.getAttribute("data-val-path");
      if (!attribute) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
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
        // The canvas's outline colour, so a pick looks the same in both
        <style>{`[${HOVER_ATTRIBUTE}] { outline: 2px solid ${DEFAULT_CANVAS_SELECTION}; outline-offset: 2px; cursor: pointer; }`}</style>
      )}
      {children}
    </div>
  );
}
