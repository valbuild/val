import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Json } from "@valbuild/core";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import { settingsModuleFilePath } from "./assistantSettings";
import {
  NO_THEME_SETTINGS,
  ThemeSettings,
  readThemeSettings,
} from "./themeSettings";

/**
 * The project's `theme` section, from the settings module.
 *
 * `NO_THEME_SETTINGS` while the schemas load, and for a project that has no
 * settings module or an ambiguous one — the Studio then looks exactly as it
 * always has, which is the right thing to show for "we do not know yet". A
 * theme that arrives late is a flash of the wrong colour; a theme that never
 * arrives is just Val's green.
 */
export function useThemeSettings(): ThemeSettings {
  return useThemeSettingsOf(useValSystem()?.system ?? null);
}

/**
 * The same answer, for a caller that holds the system rather than the context.
 *
 * `ValProvider` is the one, for the same reason it cannot use
 * `useAssistantAvailability`: it builds the system in its own body and mounts
 * `ValThemeProvider` ABOVE the provider that puts the system in context. The
 * subscriptions below are not a shortcut around the stores — they are what
 * every other reader gets from `useShallowSourceAtPath`.
 */
export function useThemeSettingsOf(system: System | null): ThemeSettings {
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
  // The count of modules with a schema, for the same reason
  // `useAssistantAvailabilityOf` uses it: `SchemaStore` keeps versions per
  // module and has no global one, and intake replaces the whole map at once.
  const schemasVersion = useSyncExternalStore(
    subscribeToSchemas,
    useCallback(
      () =>
        system === null ? 0 : Object.keys(system.schemaStore.all()).length,
      [system],
    ),
    () => 0,
  );
  return useMemo((): ThemeSettings => {
    void sourcesVersion;
    void schemasVersion;
    if (system === null) {
      return NO_THEME_SETTINGS;
    }
    const moduleFilePath = settingsModuleFilePath(system.schemaStore.all());
    if (moduleFilePath === null) {
      return NO_THEME_SETTINGS;
    }
    const source: Json | undefined =
      system.sourceStore.moduleSource(moduleFilePath);
    return readThemeSettings(source);
  }, [system, sourcesVersion, schemasVersion]);
}
