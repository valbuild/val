import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Json, ModuleFilePath } from "@valbuild/core";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import { settingsModuleFilePath } from "./assistantSettings";

/**
 * The project's settings module: which one it is, and what is in it.
 *
 * Both halves, because "there is no settings module" and "the settings module
 * has not loaded" are different answers and at least one caller has to tell
 * them apart. `useAssistantAvailabilityOf` is the one: a project with no
 * settings module has an assistant (`"on"`), and a project whose settings have
 * not arrived must NOT be answered from an empty source, or every project with
 * a configured assistant shows one state and then another.
 */
export type SettingsModuleSource = {
  /**
   * `null` for a project with no settings module, for one with two of them
   * (`resolveSettingsModule` refuses to pick a winner), and while the schemas
   * are still loading.
   */
  moduleFilePath: ModuleFilePath | null;
  /** `undefined` when there is no module, or its source has not arrived yet. */
  source: Json | undefined;
};

/**
 * The half that every reader of `s.settings()` needs and none of them is about:
 * find the settings module among the schemas, subscribe to it, hand back its
 * source as `Json`. What each section MEANS is then a pure function of that —
 * `readThemeSettings`, `readAssistantSettings`, `readStudioSettings` — which is
 * what makes those testable without a store.
 *
 * Two subscriptions rather than one, because two different things change:
 * intake replaces the whole schema map at once, and a patch changes the source
 * afterwards.
 */
export function useSettingsModuleSourceOf(
  system: System | null,
): SettingsModuleSource {
  const subscribeToSources = useCallback(
    (onChange: () => void) => {
      if (system === null) return () => {};
      return system.sourceStore.events.on("source:change", onChange);
    },
    [system],
  );
  const sourcesVersion = useSyncExternalStore(
    subscribeToSources,
    useCallback(
      () => (system === null ? 0 : system.sourceStore.sourcesVersion()),
      [system],
    ),
    () => 0,
  );
  const subscribeToSchemas = useCallback(
    (onChange: () => void) => {
      if (system === null) return () => {};
      return system.schemaStore.events.on("schema:init", onChange);
    },
    [system],
  );
  // The count of modules with a schema: `SchemaStore` keeps versions per module
  // and has no global one, and intake replaces the whole map at once.
  const schemasVersion = useSyncExternalStore(
    subscribeToSchemas,
    useCallback(
      () =>
        system === null ? 0 : Object.keys(system.schemaStore.all()).length,
      [system],
    ),
    () => 0,
  );
  return useMemo((): SettingsModuleSource => {
    void sourcesVersion;
    void schemasVersion;
    if (system === null) {
      return { moduleFilePath: null, source: undefined };
    }
    const moduleFilePath = settingsModuleFilePath(system.schemaStore.all());
    if (moduleFilePath === null) {
      return { moduleFilePath: null, source: undefined };
    }
    return {
      moduleFilePath,
      source: system.sourceStore.moduleSource(moduleFilePath),
    };
  }, [system, sourcesVersion, schemasVersion]);
}

/** The same, for a caller inside the system context. */
export function useSettingsModuleSource(): SettingsModuleSource {
  return useSettingsModuleSourceOf(useValSystem()?.system ?? null);
}
