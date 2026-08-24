import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { System } from "../createSystem";

/**
 * # The React layer over the store system
 *
 * These hooks are the reason the store system exists: everything else in
 * `stores/` is measured and tested, and none of it reaches a screen until a
 * component can read it.
 *
 * ## Why these exist alongside `ValFieldProvider`
 *
 * These were written as a parallel layer while `ValSyncEngine` still existed, so
 * that `ValFieldProvider`'s ~25 hooks could be moved across one at a time with
 * the engine still there to disagree with. The engine is gone and
 * `ValFieldProvider` is now built on the stores directly, so what is left here is
 * the SMALL, DIRECTLY TESTED surface: `hooks.test.tsx` drives these, and what it
 * pins — that a mounting field paints once, that a field is not woken by its own
 * keystroke — is true of `ValFieldProvider`'s hooks for the same reasons.
 *
 * ## What was different, and it is the whole point
 *
 * The engine's finest source subscription was per MODULE
 * (`subscribe("source", moduleFilePath)`), and its `useSourceAtPath` walked the
 * module path inside the hook. So every mounted field in an edited module
 * re-rendered on every keystroke — measured at 16 of 16 fields, against 0 here.
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
};

/**
 * ## Why `useSyncExternalStore` rather than `useState` + `useEffect`
 *
 * The obvious alternative is to hold the value in state and set it from a
 * listener. It buys the same thing for the common case and it is simpler to read,
 * so it is worth writing down what it does not cover.
 *
 * - **The subscribe race.** A change that lands between the first render's read
 *   and the effect attaching the listener is missed PERMANENTLY: the field shows a
 *   stale value with nothing to correct it. That window is not hypothetical here —
 *   it is exactly where `host.receive` lands during startup. `useSyncExternalStore`
 *   re-reads after subscribing and compares.
 * - **Tearing.** Two components rendering in one pass, one before a change and one
 *   after, showing different values for the same path.
 * - **A changed `path` prop.** State initialised once per mount is stale until the
 *   effect re-runs; `getSnapshot` is re-read every render.
 *
 * All three are re-derivable by hand, and doing so is most of what
 * `useSyncExternalStore` is. It is also what `ValFieldProvider` uses, so the two
 * behave the same way for the same reasons.
 *
 * The real cost of the choice is that `getSnapshot` must be reference-stable — and
 * that contract is what produced two of the four store bugs this layer found. The
 * answer was not to abandon the hook but to put the stability where it belongs:
 * `peek` is reference-stable in all three stores now, by recomputing and comparing
 * rather than by keeping an invalidation list. So there is no snapshot cache in
 * this layer at all; there used to be, and the store owed it instead.
 */

const ValSystemContext = createContext<ValSystem | null>(null);

export function ValSystemProvider({
  system,
  children,
}: {
  system: System;
  children: ReactNode;
}) {
  // Memoised on `system`, so the context value is stable while the system is. A
  // fresh object here would re-render every consumer on every provider render.
  const value = useMemo<ValSystem>(() => ({ system }), [system]);
  return (
    <ValSystemContext.Provider value={value}>
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
 * the null case to its own `loading`/`not-found`, which is what
 * `ValFieldProvider`'s hooks do too.
 */
export function useValSystem(): ValSystem | null {
  return useContext(ValSystemContext);
}
