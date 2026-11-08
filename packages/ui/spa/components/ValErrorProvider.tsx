import React, { useCallback, useEffect, useSyncExternalStore } from "react";
import type {
  ModuleFilePath,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { useValSystem } from "../stores/react/SystemContext";
import { useValidationErrorsAtPath } from "../stores/react/useValidationErrors";

/**
 * Validation errors, for the components that show them.
 *
 * ## Why there is still a provider here
 *
 * It holds nothing. `ValidationStore` is in the system, and both hooks below
 * reach it through `useValSystem()`. What the provider still does is mark the
 * boundary these hooks are valid inside, and keep the import path every consumer
 * already uses — ~10 components import `useAllValidationErrors` from here.
 */
export function ValErrorProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/**
 * This path's errors, already filtered to the ones a user must act on.
 *
 * Per module underneath — see `useValidationErrorsAtPath`: both halves of
 * validation walk the whole module, so results are produced per module and the
 * caller filters. That is one wake per result instead of one per field.
 */
export function useValidationErrors(sourcePath: SourcePath): ValidationError[] {
  return useValidationErrorsAtPath(sourcePath);
}

/**
 * Every surfaced validation error in the project, keyed by source path.
 *
 * ## What "surfaced" means, and why it is not the raw errors
 *
 * Two passes stand between a schema's complaint and something worth showing:
 *
 * - `resolveSchemaSourceFixes` resolves cross-module fixes (`keyof:check-keys`,
 *   `router:check-route`) against the live schema and source, so no consumer
 *   sees the raw "version mismatch" text a core schema emits.
 * - `partitionValidationErrors` drops the fixes the SERVER applies on save —
 *   image and file metadata, remote files, gallery directory checks. Showing
 *   those would be telling the user to fix something that fixes itself.
 *
 * ## Only for modules that have been validated
 *
 * This does NOT validate the project. `ValidationStore` computes per module and
 * on demand, and the demand signal is a field being on screen — so this reports
 * what is known, and a module nobody has opened contributes nothing.
 *
 * The engine's version looked whole-project because it invalidated its entire
 * error map on every patch and recomputed it on the next read, which is the
 * per-keystroke whole-project cost this design exists to remove. Every consumer
 * of this hook (the nav tree's error badges, the publish gate, the errors panel)
 * shows errors for what the user has looked at; the one that must be complete —
 * the publish gate — does not rely on this: `system.publish` validates the
 * affected modules itself before it will publish.
 */
export function useAllValidationErrors(): Record<
  SourcePath,
  ValidationError[]
> {
  const val = useValSystem();

  /**
   * One answer for the whole Studio, not one per caller.
   *
   * `ValidationStore.surfacedErrors` works the answer out once per validation
   * event and per module (a module is filtered only when its result is new),
   * and hands every caller the same object while it holds -- including after a
   * revalidation that found the same messages, which is most of them. That
   * stability is load-bearing: the nav tree is memoised on this value, and the
   * tree holds a Radix `ScrollArea` inside an `AccordionContent`, both of which
   * measure and set state from a ref. A new object per event rebuilt the tree,
   * and enough rebuilds in a row became "Maximum update depth exceeded" thrown
   * from a ref callback that names nothing about validation.
   *
   * It used to be a counter and a memo in each caller, each filtering every
   * validated module on every event: eight callers on the gallery page, and
   * loading a `.jsonValues()` record revalidates it once per batch. At 10,000
   * posts that was the long tasks of "used by" (`scenarios/measure/results.md`,
   * "The Studio, built"). `surfacedValidationErrors.test.tsx` counts it.
   */
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      const offResult = val.system.validationStore.events.on(
        "validation:result",
        onChange,
      );
      const offStale = val.system.validationStore.events.on(
        "validation:invalidate",
        onChange,
      );
      return () => {
        offResult();
        offStale();
      };
    },
    [val],
  );
  const getSnapshot = useCallback(
    () =>
      val === null ? NO_ERRORS : val.system.validationStore.surfacedErrors(),
    [val],
  );
  const errors = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  /**
   * Stale modules whose last answer SHOWS an error, which this hook is still
   * showing -- see `peekLastKnown`.
   *
   * Showing them makes this hook a demand for them, so it asks: something has
   * to replace the old answer, or an error the editor has just fixed would
   * stay on the Publish button until a field in that module happened to be
   * on screen. A module that shows nothing is shown as clean either way and
   * is left to whoever asks for it next -- this only adds work where an error
   * would otherwise be stuck. Every caller asks; `validate` joins a pass
   * already in flight, so eight callers are one pass.
   *
   * What it shows, not what it raised: a raw answer can be all markers that
   * resolve to nothing (every post that picks an image the build's snapshot
   * of the gallery does not have). Asking by the raw answer revalidated such
   * a module once per batch of a `.jsonValues()` load, sending the whole
   * module to the validation worker each time -- at 10,000 posts the largest
   * cost left in "used by" (`scenarios/measure/results.md`).
   */
  useEffect(() => {
    if (val === null) return;
    const store = val.system.validationStore;
    const revalidateStaleShowingErrors = () => {
      for (const moduleFilePath of val.system.sourceStore.loadedModules()) {
        if (!store.isStale(moduleFilePath)) continue;
        const shown = store.surfacedOf(store.peekLastKnown(moduleFilePath));
        if (shown !== null && Object.keys(shown).length > 0) {
          void store.validate(moduleFilePath);
        }
      }
    };
    revalidateStaleShowingErrors();
    // After the event, not inside it: an invalidation is announced from
    // inside the source store's own change, and a validation started there
    // would read a store that is still moving.
    let disposed = false;
    const offStale = store.events.on("validation:invalidate", () => {
      queueMicrotask(() => {
        if (!disposed) revalidateStaleShowingErrors();
      });
    });
    return () => {
      disposed = true;
      offStale();
    };
  }, [val]);

  return errors;
}

const NO_ERRORS: Record<SourcePath, ValidationError[]> = {};

/** Re-exported: several components import it from here rather than the store. */
export type { ModuleFilePath };
