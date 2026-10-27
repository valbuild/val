import { useMemo } from "react";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import { useSettingsModuleSourceOf } from "./useSettingsModuleSource";
import { ThemeSettings, readThemeSettings } from "./themeSettings";

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
 * `ValThemeProvider` ABOVE the provider that puts the system in context.
 * Subscribing to the stores directly is not a shortcut around them — see
 * `useSettingsModuleSourceOf`, which is what every reader of `s.settings()`
 * shares.
 */
export function useThemeSettingsOf(system: System | null): ThemeSettings {
  const { source } = useSettingsModuleSourceOf(system);
  return useMemo(() => readThemeSettings(source), [source]);
}
