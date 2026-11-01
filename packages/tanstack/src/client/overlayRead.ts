import type { Json, ModuleFilePath } from "@valbuild/core";
import { stegaEncode, type Resolvable } from "@valbuild/react/stega";

/**
 * How `useVal` turns what the page holds into the value a component gets:
 * the draft store's source when draft mode is on and the store has the module,
 * else the proposal's saved Source (`snapshot`), else -- `getModule` answering
 * `undefined` -- the bundle's own. Plain functions, so the scenario harness
 * (`scenarios/`) reads a page exactly as the hook does.
 */

/** Where a module's source comes from, for one read. */
export function overlaySourceOf(
  moduleMap: Record<ModuleFilePath, Json> | undefined,
  draftMode: boolean | null,
  snapshot: Record<ModuleFilePath, Json> | undefined,
): (moduleId: string) => Json | undefined {
  return (moduleId) => {
    if (moduleMap && draftMode) {
      const draft = moduleMap[moduleId as ModuleFilePath];
      if (draft !== undefined) {
        return draft;
      }
    }
    // At a proposal's address: its saved Source, not the bundle's.
    return snapshot?.[moduleId as ModuleFilePath];
  };
}

/**
 * The value, encoded with edit tags when `encodes`. `filled` is a whole
 * `.jsonValues()` record with its entries loaded, which the hook loads (it
 * suspends on them) and hands in.
 */
export function readWithOverlay<T extends Resolvable>(
  selector: T,
  sourceOf: (moduleId: string) => Json | undefined,
  filled: { modulePath: string; record: Record<string, unknown> | null } | null,
  encodes: boolean,
) {
  return stegaEncode(selector, {
    disabled: !encodes,
    getModule: (moduleId) =>
      filled !== null && moduleId === filled.modulePath
        ? filled.record
        : sourceOf(moduleId),
  });
}
