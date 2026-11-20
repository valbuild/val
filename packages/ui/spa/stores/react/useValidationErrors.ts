import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Internal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import type { ValidationResult } from "../ValidationStore";
import { useValSystem } from "./SystemContext";

const STALE: ValidationResult = { status: "stale" };

/**
 * A module's validation errors, computing them if they are stale.
 *
 * ## Demand drives the computation, and this hook IS the demand
 *
 * `validationStore.peek` never computes — it reports what is known, including
 * `stale`. `validate` computes. So the hook peeks for the render and calls
 * `validate` from an effect when what it got back was stale, which is the same
 * shape `useSourceAtPath` uses for an unfetched entry and for the same reason: a
 * render must not start work.
 *
 * That is what makes validation cost one round trip per CHANGE rather than one per
 * keystroke. The engine invalidates its whole-project error map on every patch, so
 * the first read after a keystroke recomputes errors for the entire project.
 *
 * ## Per module, deliberately
 *
 * Errors are produced per module — both halves of validation walk the whole module
 * source — so a per-path subscription here would wake N fields for one result and
 * make each of them filter. The caller filters once instead, which is why
 * {@link useValidationErrorsAtPath} exists.
 */
export function useModuleValidation(
  moduleFilePath: ModuleFilePath,
): ValidationResult {
  const val = useValSystem();
  /**
   * PROTOTYPE: no `useSyncExternalStore`.
   *
   * A counter plus a memo. Two things change, one of them for the better and
   * one of them a cost this file now has to carry itself. (`useAllValidationErrors`
   * had the same shape and left it: one counter and memo per caller meant one
   * whole-project filter per caller per event, so it reads
   * `ValidationStore.surfacedErrors`, a reference-stable snapshot, through
   * `useSyncExternalStore` instead.)
   *
   * BETTER: the store no longer owes anything. `getSnapshot` had to be
   * reference-stable, and that obligation is invisible at the call site,
   * unenforceable by types, and fails by looping rather than by erroring — three
   * of the six defects behind the crashes on this branch were exactly that. Here
   * the memo caches per version, so an unstable read is simply not a hazard.
   *
   * COST: the lost-update window below, which `useSyncExternalStore` closed for
   * free. Everything else about it we were not using: it bails out on an
   * `Object.is`-equal snapshot, but the subscription is already filtered to this
   * module, so every wake-up corresponds to a real change.
   */
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const bump = useCallback(() => {
    if (mounted.current) setVersion((previous) => previous + 1);
  }, []);

  const result = useMemo<ValidationResult>(() => {
    if (val === null) {
      return STALE;
    }
    void version;
    /**
     * `peek` never computes — it reports what is known, including `stale`.
     * `validate` computes. So this reads for the render and the effect below
     * asks, which is the same shape `useSourceAtPath` uses for an unfetched
     * entry and for the same reason: a render must not start work.
     */
    const seen = val.system.validationStore.peek(moduleFilePath);
    return seen.status === "stale" ? STALE : seen;
  }, [val, moduleFilePath, version]);

  /**
   * What to DRAW, which is not `result` while the module revalidates.
   *
   * Every edit makes its module stale, and drawing stale as "no errors" took
   * the message off an invalid field for the length of each revalidation — it
   * blinked out and back in on every pause in typing, and moved everything
   * below it twice. So the field keeps the errors it had until the next pass
   * replaces them. `result` still decides whether to ask, below.
   */
  const shown = useMemo<ValidationResult>(() => {
    if (val === null || result.status !== "stale") {
      return result;
    }
    void version;
    return val.system.validationStore.peekLastKnown(moduleFilePath);
  }, [val, moduleFilePath, result, version]);

  /**
   * What is read during render, so the subscribe effect can tell whether it
   * missed something. A ref rather than a dependency: it is only ever compared,
   * never rendered from.
   */
  const rendered = useRef(result);
  rendered.current = result;

  useEffect(() => {
    if (val === null) {
      return;
    }
    // Both, because they are different news and a field needs to react to each:
    // a result is new errors, an invalidation means the ones on screen are about
    // a value that has since moved. Filtered on the module because both events
    // carry which one they are about and this hook is about one — `ValErrorProvider`
    // puts one of these on every field on screen.
    const offResult = val.system.validationStore.events.on(
      "validation:result",
      (event) => {
        if (event.moduleFilePath === moduleFilePath) {
          bump();
        }
      },
    );
    const offStale = val.system.validationStore.events.on(
      "validation:invalidate",
      (event) => {
        if (event.modules.includes(moduleFilePath)) {
          bump();
        }
      },
    );
    /**
     * THE COST OF DROPPING `useSyncExternalStore`, paid explicitly.
     *
     * Render read the store at T0; this effect attaches at T1. An event in
     * between has no listener yet and is simply lost — and validation is
     * asynchronous and kicked off by the effect below, so that window is real,
     * not theoretical. The field would sit on a stale result until something
     * else in the module happened to change.
     *
     * `useSyncExternalStore` closes this itself: it re-reads after subscribing
     * and re-renders if the snapshot moved. Doing it by hand means comparing
     * against what render actually used. Compared rather than bumped
     * unconditionally, so the common case — nothing happened in the window —
     * costs no extra render.
     */
    const now = val.system.validationStore.peek(moduleFilePath);
    const settled = now.status === "stale" ? STALE : now;
    if (settled !== rendered.current) {
      bump();
    }
    return () => {
      offResult();
      offStale();
    };
  }, [val, moduleFilePath, bump]);

  useEffect(() => {
    if (val === null || result.status !== "stale") {
      return;
    }
    void val.system.validationStore.validate(moduleFilePath);
  }, [val, moduleFilePath, result]);

  return shown;
}

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
 */
export function useValidationErrorsAtPath(
  sourcePath: SourcePath,
): ValidationError[] {
  const val = useValSystem();
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const result = useModuleValidation(moduleFilePath);
  // Once per module RESULT, for every field under it and the whole-project
  // readers alike: see `ValidationStore.surfacedOf` for why the result object
  // is the right key, and what invalidates it.
  const surfaced = useMemo(
    () => (val === null ? null : val.system.validationStore.surfacedOf(result)),
    [val, result],
  );
  return surfaced?.[sourcePath] ?? NO_ERRORS;
}
