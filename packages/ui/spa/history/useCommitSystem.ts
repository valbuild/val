import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type {
  HistoricalModule,
  HistoricalPatchSet,
} from "@valbuild/shared/internal";
import { useMemo } from "react";
import { createReadOnlySystem } from "../stores/readOnlySystem";
import { useValSystem } from "../stores/react/SystemContext";
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
  /**
   * One more module to lay on top, for a module the commit did not change.
   *
   * An argument rather than a second system built next door. The pane used to
   * build a whole `createReadOnlySystem` per module navigated to — a fresh
   * store graph, its bus, its validation debounce and its patch sync, for one
   * module, discarded on the next navigation. Nothing was disposing them, and
   * a dispose effect is not the fix either: `ValStoreProvider` has the incident
   * note for what happens when a cleanup tears down a system built outside the
   * effect (StrictMode runs it on a component that stays mounted, and the
   * listeners attached at construction never come back).
   *
   * Folded in here instead, so a pane has exactly ONE system however far the
   * editor navigates.
   */
  outside?: {
    moduleFilePath: ModuleFilePath;
    module: HistoricalModule;
  } | null,
): System | null {
  const live = useValSystem();
  return useMemo(() => {
    if (!patchSet) {
      return null;
    }
    /*
     * Start from the project as it is, then lay the commit on top.
     *
     * A commit knows only the modules it changed, but the fields in those
     * modules do not stay inside them: a `keyOf` indexes another module, a
     * gallery-backed `s.image(galleryVal)` reads its dimensions from one, a
     * route field resolves against one. Given only the commit's modules, every
     * one of those renders as missing or stuck loading — the pane promises the
     * real field renderers and then breaks exactly the ones that reach across
     * modules.
     *
     * Seeding with today's schemas and sources gives them something to resolve
     * against. It is honest as long as the OVERLAY wins, which it does: for
     * every module the commit recorded, the commit's version replaces today's
     * entirely. What is left underneath is only the modules the commit did not
     * touch, and for those "as it is now" is the closest thing we know — and it
     * is what the field was pointing at anyway.
     *
     * Two things to be exact about, because the seed is easy to read as more
     * than it is. `allSources()` is the live store's source WITH pending
     * patches applied, so what shows through is today's DRAFT — including
     * unpublished edits — not today's published state. That is the least
     * surprising answer for a `keyOf` or a gallery reference, since it is what
     * the editor sees on the left. And it is read ONCE, when this memo runs: an
     * edit made on the left afterwards is not reflected on the right until the
     * commit changes. Both are deliberate for a reference target and neither is
     * right for a value being compared, which is why nothing compares against
     * the seed.
     */
    const schemas: Record<ModuleFilePath, SerializedSchema | undefined> = {
      ...(live?.system.schemaStore.all() ?? {}),
    };
    const sources: Record<ModuleFilePath, Json | undefined> = {
      ...(live?.system.sourceStore.allSources() ?? {}),
    };
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
        /*
         * Its schema was stored but this version of Val cannot read it (see
         * `schema-unreadable`). Today's version of the module is REMOVED rather
         * than left showing through: the seed is there so cross-module
         * references resolve, not so a module the commit changed can quietly
         * render as it is now while claiming to be as it was.
         */
        delete schemas[moduleFilePath];
        delete sources[moduleFilePath];
        continue;
      }
      schemas[moduleFilePath] = module.schema;
      sources[moduleFilePath] = module.source;
    }
    // The module the editor navigated to, if the commit did not change it. Laid
    // on last so it wins over the seed, exactly as the commit's own modules do.
    if (outside && outside.module.schema !== null) {
      schemas[outside.moduleFilePath] = outside.module.schema;
      sources[outside.moduleFilePath] = outside.module.source;
    }
    return createReadOnlySystem({
      schemas,
      sources,
      noServerReason: "This is how things were; there is nothing pending here",
    });
  }, [patchSet, live, outside]);
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
