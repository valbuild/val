"use client";

import type { ValModules } from "@valbuild/core";
import { useEffect } from "react";

declare global {
  interface Window {
    __VAL_MODULES__?: ValModules;
  }
}

// Keep in sync with VAL_MODULES_UPDATED_EVENT in @valbuild/ui (useValModules.ts).
const VAL_MODULES_UPDATED_EVENT = "val-modules-updated";

/**
 * Registers the user's `val.modules` registry on `window.__VAL_MODULES__` so
 * the Val editor SPA (both the `/val` app and the on-page overlay) can read it.
 *
 * Must be called from a Client Component that statically imports `val.modules`:
 * the module `def` entries are function closures, so the registry cannot be
 * passed as a prop across the Server → Client Component boundary and must be
 * pulled into the client bundle and registered via the window global instead.
 *
 * Re-runs when the `modules` reference changes (e.g. on HMR) and dispatches
 * `val-modules-updated` so the SPA picks up the new registry.
 */
export function useRegisterValModules(modules: ValModules): void {
  useEffect(() => {
    window.__VAL_MODULES__ = modules;
    window.dispatchEvent(new CustomEvent(VAL_MODULES_UPDATED_EVENT));
  }, [modules]);
}

/**
 * Registers the user's `val.modules` registry for the Val editor SPA.
 *
 * Render this inside both `<ValProvider>` (root layout) and `<ValApp>` (the
 * `/val` page), passing your `val.modules` default export. Use it from a
 * Client Component so the registry ends up in the client bundle:
 *
 * @example
 * "use client";
 * import { ValModulesClient } from "@valbuild/next";
 * import valModules from "../../val.modules";
 *
 * export function RegisterValModules() {
 *   return <ValModulesClient modules={valModules} />;
 * }
 */
export function ValModulesClient({ modules }: { modules: ValModules }) {
  useRegisterValModules(modules);
  return null;
}
