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
 * What a person who tries to upload in the demo is told. The demo's server
 * runs in their tab and serves no files, so the bytes would have nowhere to
 * go -- but the gallery is full, and picking from it works.
 */
export const DEMO_UPLOADS_OFF =
  "Uploading is not part of the demo. Pick an image that is already in the gallery instead.";
