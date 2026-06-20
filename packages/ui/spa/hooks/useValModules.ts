import type { ValModules } from "@valbuild/core";
import { useEffect, useState } from "react";

export const VAL_MODULES_UPDATED_EVENT = "val-modules-updated";

/**
 * Reads the user's ValModules registry from `window.__VAL_MODULES__`, which
 * is set by the host Next.js app's `<ValModulesClient>` / `useRegisterValModules`
 * (rendered inside `ValProvider` and `ValApp`) before the SPA bundle mounts.
 *
 * Listens for the `val-modules-updated` event so HMR-driven reference swaps
 * in the host app propagate into the SPA's React tree.
 */
export function useValModules(): ValModules | null {
  const [modules, setModules] = useState<ValModules | null>(() =>
    typeof window !== "undefined" ? (window.__VAL_MODULES__ ?? null) : null,
  );
  useEffect(() => {
    const handler = () => {
      setModules(window.__VAL_MODULES__ ?? null);
    };
    if (window.__VAL_MODULES__) {
      setModules(window.__VAL_MODULES__);
    }
    window.addEventListener(VAL_MODULES_UPDATED_EVENT, handler);
    return () => {
      window.removeEventListener(VAL_MODULES_UPDATED_EVENT, handler);
    };
  }, []);
  return modules;
}
