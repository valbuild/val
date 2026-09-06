import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { useMemo } from "react";
import { createReadOnlySystem } from "../stores/readOnlySystem";
import type { System } from "../stores/createSystem";

/**
 * A store system that shows the project as one commit left it.
 *
 * This is the whole two-pane mechanism. The Studio's field components read
 * their schema and their source through `useValSystem()`, one `useContext`
 * call — so a subtree wrapped in a system built from a commit renders that
 * commit, using the real field renderers, with no field component aware that
 * history exists. The schema comes from the commit too, which is what makes a
 * module whose schema has since changed renderable at all rather than a value
 * shown against a shape it never had.
 *
 * Keyed on the commit, so flipping between commits does not rebuild a system
 * per render — and a reconstructed commit cannot change, so there is nothing
 * that would make a rebuild correct.
 */
export function useCommitSystem(
  patchSet: HistoricalPatchSet | undefined,
): System | null {
  return useMemo(() => {
    if (!patchSet) {
      return null;
    }
    const schemas: Record<ModuleFilePath, SerializedSchema | undefined> = {};
    const sources: Record<ModuleFilePath, Json | undefined> = {};
    for (const [path, module] of Object.entries(patchSet.modules)) {
      const moduleFilePath = path as ModuleFilePath;
      /*
       * A module with no schema is left OUT rather than given an empty one.
       *
       * Its schema was stored but this version of Val cannot read it (see
       * `schema-unreadable`). Handing the stores a placeholder would render it
       * as an empty module — the one reading that is actively wrong. Left out,
       * the pane reports it as a module it cannot show, which is true, and
       * `unavailableModules` below is how the UI knows to say so.
       */
      if (module.schema === null) {
        continue;
      }
      schemas[moduleFilePath] = module.schema;
      sources[moduleFilePath] = module.source;
    }
    return createReadOnlySystem({
      schemas,
      sources,
      noServerReason: "This is how things were; there is nothing pending here",
    });
  }, [patchSet]);
}

/**
 * The modules of a commit that cannot be shown, and why.
 *
 * Separate from the system because the system's job is to answer for modules it
 * HAS. Something still has to account for the ones it does not, or they simply
 * go missing from the pane — which reads as "this commit did not change that"
 * rather than "we cannot show you that", and those are very different claims.
 */
export function unavailableModules(
  patchSet: HistoricalPatchSet | undefined,
): { moduleFilePath: ModuleFilePath; reason: string }[] {
  if (!patchSet) {
    return [];
  }
  const result: { moduleFilePath: ModuleFilePath; reason: string }[] = [];
  for (const [path, module] of Object.entries(patchSet.modules)) {
    if (module.schema !== null) {
      continue;
    }
    const schemaFailure = module.failures.find(
      (failure) => failure.kind === "schema-unreadable",
    );
    result.push({
      moduleFilePath: path as ModuleFilePath,
      reason: schemaFailure
        ? // Deliberately not alarming: this is a version difference, not damage.
          "This module was saved with a different version of Val, so it cannot be shown here. Nothing is lost."
        : "Nothing was recorded for this module at this commit, so it cannot be shown.",
    });
  }
  return result;
}
