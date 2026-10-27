"use client";

import { VAL_PREVIEW_MESSAGES } from "@valbuild/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type === VAL_PREVIEW_MESSAGES.refresh) {
        router.refresh();
      }
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, [router]);

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

  // `flow-root` so the first and last child's margins stay inside the box
  // being measured, rather than collapsing through it.
  return (
    <div ref={ref} style={{ display: "flow-root" }}>
      {children}
    </div>
  );
}
