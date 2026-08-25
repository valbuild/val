import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  Internal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import type { ValidationResult } from "../ValidationStore";
import { useValSystem } from "./SystemContext";

const noopSubscribe = () => () => {};
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

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) {
        return () => {};
      }
      // Both, because they are different news and a field needs to react to
      // each: a result is new errors, an invalidation means the ones on screen
      // are about a value that has since moved.
      //
      // Filtered on the module, because both events carry which one they are
      // about and this hook is about one. Not a correctness fix: `peek` returns
      // a stored, reference-stable object, so an unrelated module's event
      // produced an identical snapshot and `useSyncExternalStore` did not
      // re-render. It is a fan-out fix — `ValErrorProvider` puts one of these on
      // every field on screen, so an unfiltered subscription made every
      // validation event cost a `getSnapshot` per mounted field.
      const offResult = val.system.validationStore.events.on(
        "validation:result",
        (event) => {
          if (event.moduleFilePath === moduleFilePath) {
            onChange();
          }
        },
      );
      const offStale = val.system.validationStore.events.on(
        "validation:invalidate",
        (event) => {
          if (event.modules.includes(moduleFilePath)) {
            onChange();
          }
        },
      );
      return () => {
        offResult();
        offStale();
      };
    },
    [val, moduleFilePath],
  );

  /**
   * `peek` returns a stored result object, which is reference-stable while the
   * result stands — the store replaces it only when it recomputes. A `stale`
   * answer is the shared constant, so repeated stale peeks do not churn.
   */
  const getSnapshot = useCallback(() => {
    if (val === null) {
      return STALE;
    }
    const seen = val.system.validationStore.peek(moduleFilePath);
    return seen.status === "stale" ? STALE : seen;
  }, [val, moduleFilePath]);

  const result = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    if (val === null || result.status !== "stale") {
      return;
    }
    void val.system.validationStore.validate(moduleFilePath);
  }, [val, moduleFilePath, result]);

  return result;
}

/**
 * Just this path's errors.
 *
 * A stable empty array for "no errors", because returning a fresh `[]` would make
 * every field with nothing wrong re-render whenever any module revalidated.
 */
const NO_ERRORS: ValidationError[] = [];

export function useValidationErrorsAtPath(
  sourcePath: SourcePath,
): ValidationError[] {
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const result = useModuleValidation(moduleFilePath);
  if (result.status !== "validated" || result.errors === false) {
    return NO_ERRORS;
  }
  return result.errors[sourcePath] ?? NO_ERRORS;
}
