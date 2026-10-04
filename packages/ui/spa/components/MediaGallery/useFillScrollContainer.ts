import { RefObject, useLayoutEffect, useState } from "react";

/** The nearest ancestor that scrolls vertically, or null for the window. */
function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * The height that makes `ref`'s element fill what is left of its scroll
 * container — the Studio's content area — so the PAGE does not scroll and
 * the element's own panes do.
 *
 * Measured, not a `calc(100dvh - …)`: what sits above the element (the
 * module's heading, a notice, an upload's progress) and below it (the
 * content area's padding) varies, and a constant goes wrong as soon as one of
 * them does. The container's scroll height is what says how much is left.
 *
 * `null` until measured, and never less than `min`: on a short window the
 * page scrolling is better than a gallery too small to use.
 */
export function useFillScrollContainer(
  ref: RefObject<HTMLElement | null>,
  { enabled, min }: { enabled: boolean; min: number },
): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setHeight(null);
      return;
    }
    const container = scrollContainerOf(element);
    const measure = () => {
      // The container's padding box: its border is not room to fill.
      const viewport = container
        ? {
            top: container.getBoundingClientRect().top + container.clientTop,
            bottom:
              container.getBoundingClientRect().top +
              container.clientTop +
              container.clientHeight,
          }
        : { top: 0, bottom: window.innerHeight };
      const scrollTop = container ? container.scrollTop : window.scrollY;
      const viewportHeight = viewport.bottom - viewport.top;
      // Where the element starts and ends, in the container's content.
      const rect = element.getBoundingClientRect();
      const top = rect.top - viewport.top + scrollTop;
      // Where the content ends: measured off the content itself, never off
      // `scrollHeight`, which is never less than the container's own height —
      // on a page shorter than the window it counts the empty space below as
      // something to leave room for, and the element came out at its minimum.
      const content = container ?? document.body;
      let contentBottom = top + rect.height;
      for (const child of Array.from(content.children)) {
        const bottom = child.getBoundingClientRect().bottom;
        contentBottom = Math.max(
          contentBottom,
          bottom - viewport.top + scrollTop,
        );
      }
      const after = Math.max(0, contentBottom - (top + rect.height));
      const next = Math.max(min, Math.floor(viewportHeight - top - after));
      setHeight((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container ?? document.documentElement);
    // What is above or below the element can change height too — the page
    // still loading, a notice appearing — and that moves its top, or the
    // room under it, without resizing the container. The container's content
    // is what says so.
    const content = container?.firstElementChild;
    if (content) {
      observer.observe(content);
    }
    if (element.parentElement) {
      observer.observe(element.parentElement);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, enabled, min]);
  return height;
}
