import { createContext, useContext } from "react";
import type { ValDemoRuntime } from "@valbuild/shared/internal";

/**
 * The demo this Studio runs in, or null for a real one.
 *
 * Read from `window.__VAL_DEMO__` once, in `App`, and provided from there:
 * whether this is a demo cannot change while the Studio is open.
 */
export const ValDemoContext = createContext<ValDemoRuntime | null>(null);

export function useValDemo(): ValDemoRuntime | null {
  return useContext(ValDemoContext);
}

/**
 * Why "Open in a new tab" is off in the demo, said where it is offered.
 *
 * A demo's edits are in this tab's memory, so another tab would show the site
 * without them. The button stays, so the demo still shows that it exists.
 */
export const DEMO_NEW_TAB_OFF =
  "Opens the page in a new tab, with your unpublished changes. Not in the demo: your changes live only in this tab.";
