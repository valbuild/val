import { useEffect, useState } from "react";
import { ShellBreakpoint } from "./types";

/** Below this the shell is a mobile app: sheets, bottom bar, no rail. */
export const SHELL_MOBILE_BREAKPOINT = 768;
/** At and above this the shell shows its full desktop chrome (left rail). */
export const SHELL_DESKTOP_BREAKPOINT = 1200;

function breakpointOf(width: number): ShellBreakpoint {
  if (width < SHELL_MOBILE_BREAKPOINT) return "mobile";
  if (width < SHELL_DESKTOP_BREAKPOINT) return "tablet";
  return "desktop";
}

/**
 * The breakpoint the shell is currently at.
 *
 * Read synchronously on first render (rather than in an effect) so the shell
 * never paints the wrong chrome first: a mobile viewport must not flash the
 * desktop rail, and screenshots must not race the effect.
 */
export function useShellBreakpoint(): ShellBreakpoint {
  const [breakpoint, setBreakpoint] = useState<ShellBreakpoint>(() =>
    typeof window === "undefined" ? "desktop" : breakpointOf(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setBreakpoint(breakpointOf(window.innerWidth));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return breakpoint;
}
