import React, { useCallback, useEffect, useMemo, useRef } from "react";
import type {
  ModuleFilePath,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { useValSystem } from "../stores/react/SystemContext";
import { useValidationErrorsAtPath } from "../stores/react/useValidationErrors";
import { filterBlockingValidationErrors } from "../validation/blockingValidationErrors";

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
  const [version, bump] = useVersion();

  useEffect(() => {
    if (val === null) return;
    const offResult = val.system.validationStore.events.on(
      "validation:result",
      bump,
    );
    const offStale = val.system.validationStore.events.on(
      "validation:invalidate",
      bump,
    );
    return () => {
      offResult();
      offStale();
    };
  }, [val, bump]);

  /**
   * The last answer, returned again when a recompute produces the same one.
   *
   * Not an optimisation — a loop fix. This hook wakes on EVERY validation event
   * in the project, and most of them do not change what it answers: a module
   * being invalidated and revalidated with the same errors is the common case,
   * and loading a `.jsonValues()` record announces one per batch. Each of those
   * used to hand back a brand-new object.
   *
   * `NavMenuWrapper` memoises the whole nav tree on this value, so a new object
   * rebuilt the entire tree — and the tree contains a Radix `ScrollArea` inside
   * an `AccordionContent`, both of which measure and set state from a ref. Enough
   * rebuilds in a row and that becomes "Maximum update depth exceeded", thrown
   * from inside a ref callback that names nothing about validation. It took a
   * React component stack to find; the JS stack is pure Radix.
   *
   * Same rule the stores follow for anything read on a render path: recompute and
   * compare, never trust that a wake-up means a change.
   */
  const previous = useRef<Record<SourcePath, ValidationError[]> | null>(null);
  return useMemo(() => {
    if (val === null) return {};
    void version;
    const raw: Record<SourcePath, ValidationError[]> = {};
    for (const moduleFilePath of val.system.sourceStore.loadedModules()) {
      const result = val.system.validationStore.peek(moduleFilePath);
      if (result.status !== "validated" || result.errors === false) {
        continue;
      }
      for (const [sourcePath, errors] of Object.entries(result.errors)) {
        if (errors && errors.length > 0) {
          raw[sourcePath as SourcePath] = errors;
        }
      }
    }
    const next = filterBlockingValidationErrors(
      raw,
      val.system.schemaStore.all(),
      val.system.sourceStore.allSources(),
    );
    const held = previous.current;
    if (held !== null && sameErrors(held, next)) {
      return held;
    }
    previous.current = next;
    return next;
  }, [val, version]);
}

/**
 * Do two error maps say the same thing?
 *
 * Compared by MESSAGE rather than by object identity, because the resolving pass
 * rebuilds error objects: `resolveSchemaSourceFixes` turns a `router:check-route`
 * marker into a different error, so identity would report every recompute as a
 * change and the comparison would never hold.
 *
 * Messages are what the UI shows and what the error badges count, so two maps
 * with the same paths and the same messages are the same answer as far as every
 * consumer of this hook is concerned.
 */
function sameErrors(
  a: Record<SourcePath, ValidationError[]>,
  b: Record<SourcePath, ValidationError[]>,
): boolean {
  const aPaths = Object.keys(a);
  const bPaths = Object.keys(b);
  if (aPaths.length !== bPaths.length) {
    return false;
  }
  for (const path of aPaths) {
    const left = a[path as SourcePath];
    const right = b[path as SourcePath];
    if (right === undefined || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (left[index].message !== right[index].message) {
        return false;
      }
    }
  }
  return true;
}

/**
 * A counter and a way to move it.
 *
 * `useSyncExternalStore` is the usual shape for this and is wrong here: its
 * `getSnapshot` must be reference-stable, and the answer this hook produces is a
 * whole-project record built by two filtering passes. Building it per snapshot
 * read — which React does on every render — would either re-render forever or
 * need a cache keyed on something that does not exist. A version plus a memo
 * computes it once per change instead.
 */
function useVersion(): [number, () => void] {
  const [version, setVersion] = React.useState(0);
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
  return [version, bump];
}

/** Re-exported: several components import it from here rather than the store. */
export type { ModuleFilePath };
