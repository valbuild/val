import { createContext, useContext, type ReactNode } from "react";
import type { System } from "../createSystem";
import { PathSnapshots } from "./PathSnapshots";

/**
 * # The React layer over the store system
 *
 * These hooks are the reason the store system exists: everything else in
 * `stores/` is measured and tested, and none of it reaches a screen until a
 * component can read it.
 *
 * ## Why this is a parallel layer, not an edit to `ValFieldProvider`
 *
 * `ValFieldProvider.tsx` is 1448 lines and ~25 hooks over `ValSyncEngine`.
 * Rewriting it in place would mean one commit in which nothing can be compared
 * against anything: the engine's behaviour is the only specification these hooks
 * have, and it stops existing the moment it is replaced. So this layer mirrors
 * the engine's hook CONTRACTS — `{ status: "success" | "error" | "not-found" |
 * "loading" }` — and can therefore be swapped in one hook at a time, with the
 * engine still there to disagree with.
 *
 * ## What is different, and it is the whole point
 *
 * The engine's finest source subscription is per MODULE
 * (`subscribe("source", moduleFilePath)`), and `useSourceAtPath` then walks the
 * module path inside the hook. So every mounted field in an edited module
 * re-renders on every keystroke — measured at 16 of 16 fields, against 0 for
 * these hooks.
 *
 * These subscribe per PATH and the walk happens in the store. A field is woken
 * only when its own path moved, and the field that made the edit is not woken at
 * all (suppression is per field INSTANCE — see `SourceStore`).
 *
 * ## The rule every read hook here follows
 *
 * **`peek` to render, `get` to demand.** `peek` is synchronous, returns the
 * value, and cannot cause work, so it is what `getSnapshot` calls and why a
 * mounting field paints once. `get` is async because a `.jsonValues()` entry
 * fetch is a real round trip; it is called from an effect, only when `peek` says
 * the content is not here. See `openquestions.md` item 1.
 */
export type ValSystem = {
  system: System;
  /**
   * Reference-stable `peek` results.
   *
   * `useSyncExternalStore` requires `getSnapshot` to return the same reference
   * until the value actually changes, and `peek` builds a fresh object per call.
   * Held on the context rather than per hook so two fields on one path share one
   * held snapshot instead of each keeping their own.
   */
  snapshots: PathSnapshots;
};

const ValSystemContext = createContext<ValSystem | null>(null);

export function ValSystemProvider({
  system,
  children,
}: {
  system: System;
  children: ReactNode;
}) {
  // Not memoised on purpose: `system` is created once by the caller and
  // `PathSnapshots` must live exactly as long as it. A `useMemo` here would be a
  // cache that React is allowed to throw away, and throwing away the held
  // snapshots mid-session would make every field re-render for nothing.
  return (
    <ValSystemContext.Provider
      value={{ system, snapshots: new PathSnapshots() }}
    >
      {children}
    </ValSystemContext.Provider>
  );
}

/**
 * The system, or `null` outside a provider.
 *
 * Nullable rather than throwing, because the same components render in contexts
 * with no Val at all (a preview, a story, the host app's own tree) and a hook
 * that throws there would make every one of them a special case. Each hook maps
 * the null case to its own `loading`/`not-found`, which is what the engine's
 * hooks already do.
 */
export function useValSystem(): ValSystem | null {
  return useContext(ValSystemContext);
}
