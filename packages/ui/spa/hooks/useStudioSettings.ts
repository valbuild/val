import { useMemo } from "react";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import { useSettingsModuleSourceOf } from "./useSettingsModuleSource";
import { StudioSettings, readStudioSettings } from "./studioSettings";

/**
 * The project's `studio` section, from the settings module.
 *
 * `NO_STUDIO_SETTINGS` — everything unset — while the schemas load, and for a
 * project with no settings module or an ambiguous one. Unset is the permissive
 * answer for every field here on purpose; see `isTourOffered`.
 */
export function useStudioSettingsOf(system: System | null): StudioSettings {
  const { source } = useSettingsModuleSourceOf(system);
  return useMemo(() => readStudioSettings(source), [source]);
}

export function useStudioSettings(): StudioSettings {
  return useStudioSettingsOf(useValSystem()?.system ?? null);
}
