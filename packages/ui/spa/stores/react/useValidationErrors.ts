import { useCallback, useEffect } from "react";
import {
  Internal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import { useValSystem } from "./SystemContext";
import { sameDeep, useStoreValue } from "./useStoreValue";

/**
 * A stable empty array for "no errors", because returning a fresh `[]` would make
 * every field with nothing wrong re-render whenever any module revalidated.
 */
const NO_ERRORS: ValidationError[] = [];

/**
 * Just this path's errors, RESOLVED and filtered to what a user must act on.
 *
 * ## The filtering is not cosmetic
 *
 * A core schema cannot resolve a cross-module fix, so it emits a marker and
 * expects something with the whole project in hand to settle it. `RouteSchema`
 * emits `router:check-route` on EVERY route field, unconditionally, with the text
 * "This error (router:check-route) should typically be processed by Val
 * internally. Seeing this error most likely means you have a Val version
 * mismatch" — and `resolveSchemaSourceFixes` is what turns that into either a
 * real error or nothing.
 *
 * Returning the raw errors therefore does not merely show an ugly message: it
 * shows a route error that CANNOT clear, because nothing in the raw map ever
 * looked at whether the route is now valid. Setting the route fixed the content
 * and the field went on complaining.
 *
 * The engine did this — `getValidationErrorSnapshot` read through
 * `getAllValidationErrorsSnapshot`, which resolved and partitioned — and this
 * hook dropped it in the port while its own comment still claimed it. Restored,
 * with a test that pins it.
 *
 * ## The field renders when ITS errors move
 *
 * Validation is per module -- both halves of it walk the whole module
 * source -- and every field of the module hears of each result and each
 * invalidation. They used to render for both (a counter per field, bumped by
 * either), so one field write rendered every field of the module twice -- once to hear that the errors were stale, once to be
 * handed the same ones again (`docs/plans/studio-write-lag.md`). Here each
 * field looks its own path up in the result when one arrives -- the map is
 * built once per result, by `surfacedOf` -- and is rendered only if what it
 * finds is different (`sameDeep`: a new result is new arrays that say the
 * same).
 *
 * Demand is unchanged in what it asks and when: a reader that finds the
 * module stale asks for it once, and the store keeps at it until the answer
 * is about source that has not moved since ({@link useValidationDemand}).
 */
export function useValidationErrorsAtPath(
  sourcePath: SourcePath,
): ValidationError[] {
  const val = useValSystem();
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  useValidationDemand(moduleFilePath);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      // Both, because they are different news: a result is new errors, an
      // invalidation means the ones kept are about a value that has since
      // moved. Filtered on the module because both events say which one
      // they are about -- `ValErrorProvider` puts one of these on every
      // field on screen.
      const offResult = val.system.validationStore.events.on(
        "validation:result",
        (event) => {
          if (event.moduleFilePath === moduleFilePath) onChange();
        },
      );
      const offStale = val.system.validationStore.events.on(
        "validation:invalidate",
        (event) => {
          if (event.modules.includes(moduleFilePath)) onChange();
        },
      );
      return () => {
        offResult();
        offStale();
      };
    },
    [val, moduleFilePath],
  );
  const read = useCallback((): ValidationError[] => {
    if (val === null) return NO_ERRORS;
    const store = val.system.validationStore;
    const seen = store.peek(moduleFilePath);
    // The last errors known while the module is being validated again, so
    // typing does not blink them off and on. See `peekLastKnown`.
    const shown =
      seen.status === "stale" ? store.peekLastKnown(moduleFilePath) : seen;
    // Once per module RESULT, for every field under it and the whole-project
    // readers alike: see `ValidationStore.surfacedOf` for why the result
    // object is the right key, and what invalidates it.
    return store.surfacedOf(shown)?.[sourcePath] ?? NO_ERRORS;
  }, [val, moduleFilePath, sourcePath]);
  return useStoreValue(subscribe, read, { isSame: sameDeep });
}

/**
 * Ask for a module's validation whenever it is found stale: on mount, and
 * each time it is invalidated.
 *
 * ## Demand drives the computation, and a mounted reader IS the demand
 *
 * `validationStore.peek` never computes — it reports what is known, including
 * `stale`. `validate` computes. So a reader peeks for its render and asks
 * from here when what is known is stale, which is the same shape
 * `useSourceAtPath` uses for an unfetched entry and for the same reason: a
 * render must not start work.
 *
 * That is what makes validation cost one round trip per CHANGE rather than
 * one per keystroke. The engine invalidated its whole-project error map on
 * every patch, so the first read after a keystroke recomputed errors for the
 * entire project.
 *
 * Asked once per time the module goes stale, not once per event: a module
 * invalidated again while it is being validated is the store's to finish
 * (`ValidationStore.run`), and asking on every event is the per-keystroke
 * validation this design exists to avoid. Asked in a microtask, so the
 * computation starts after the store has finished announcing the change
 * that made it stale rather than in the middle of it.
 */
function useValidationDemand(moduleFilePath: ModuleFilePath): void {
  const val = useValSystem();
  useEffect(() => {
    if (val === null) return;
    const store = val.system.validationStore;
    let mounted = true;
    /** Whether this reader has asked for the stale module it is waiting on. */
    let asked = false;
    const look = () => {
      if (!mounted) return;
      if (store.peek(moduleFilePath).status !== "stale") {
        asked = false;
        return;
      }
      if (asked) return;
      asked = true;
      void store.validate(moduleFilePath);
    };
    look();
    const offResult = store.events.on("validation:result", (event) => {
      if (event.moduleFilePath === moduleFilePath) queueMicrotask(look);
    });
    const offStale = store.events.on("validation:invalidate", (event) => {
      if (event.modules.includes(moduleFilePath)) queueMicrotask(look);
    });
    return () => {
      mounted = false;
      offResult();
      offStale();
    };
  }, [val, moduleFilePath]);
}
