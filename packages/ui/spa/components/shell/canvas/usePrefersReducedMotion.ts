import { useEffect, useState } from "react";

/**
 * Whether the viewer has asked for less motion.
 *
 * Read in JS rather than left to a `motion-reduce:` class because the
 * transitions here are declared inline — Tailwind will not generate arbitrary
 * `transition-[left,width]` utilities, so the timing has to be set in the
 * style object, and the media query has to be checked the same way.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
