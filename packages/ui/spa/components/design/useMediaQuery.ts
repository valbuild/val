import { useEffect, useState } from "react";

/**
 * Whether a media query matches, and again whenever that changes. `false`
 * where there is no `matchMedia` (a test, a server render).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? false
      : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Narrow enough that the preview and the assistant do not fit side by side:
 * a phone, or a tablet held upright. The tab shows one at a time then.
 */
export const NARROW_DESIGN_TAB = "(max-width: 899px)";

/** A touch screen: no modifier key to hold, so picking is Select and a tap. */
export const TOUCH_SCREEN = "(any-pointer: coarse)";
