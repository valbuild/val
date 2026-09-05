import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  assistantAvailability,
  AssistantAvailability,
  Json,
} from "@valbuild/core";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import {
  readAssistantSettings,
  settingsModuleFilePath,
} from "./assistantSettings";

/**
 * Whether this project has an assistant: `"on"`, `"off"` or `"unconfigured"`.
 *
 * The project's own answer, from `s.settings()` — `assistant.enabled` — and no
 * longer from `val.config.ts`. It used to be
 * `config.ai.chat.experimental.enable`, which meant that turning the chat on for
 * the people who edit the content took a developer, a deploy, and a code review
 * of a boolean.
 *
 * Three states rather than two, and what each means is in
 * {@link assistantAvailability}. What matters at a call site is which question
 * it is asking:
 *
 * - **Should this affordance exist?** `!== "off"`. An unconfigured assistant is
 *   shown, because a hidden one is never discovered.
 * - **Can it be used right now?** `=== "on"`. An unconfigured one asks first.
 *
 * ## While the schemas load
 *
 * There is no settings module yet as far as this can tell, so it answers `"on"`
 * — the same as a project that has none. The alternative is an assistant that
 * appears late for every project that has one.
 */
export function useAssistantAvailability(): AssistantAvailability {
  return useAssistantAvailabilityOf(useValSystem()?.system ?? null);
}

/**
 * The same answer, for a caller that holds the system rather than the context.
 *
 * `ValProvider` is the one: it builds the system in its own body and mounts the
 * provider that carries this answer ABOVE the one that puts the system in
 * context, so it cannot use the hook above. Reading the stores directly is not
 * a shortcut around them — the subscriptions below are what every other reader
 * gets from `useShallowSourceAtPath`.
 */
export function useAssistantAvailabilityOf(
  system: System | null,
): AssistantAvailability {
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
  // The count of modules with a schema, for the same reason `useSchemasVersion`
  // uses it: `SchemaStore` keeps versions per module and has no global one, and
  // intake replaces the whole map at once.
  const schemasVersion = useSyncExternalStore(
    subscribeToSchemas,
    useCallback(
      () =>
        system === null ? 0 : Object.keys(system.schemaStore.all()).length,
      [system],
    ),
    () => 0,
  );
  return useMemo((): AssistantAvailability => {
    void sourcesVersion;
    void schemasVersion;
    if (system === null) {
      return "on";
    }
    const moduleFilePath = settingsModuleFilePath(system.schemaStore.all());
    if (moduleFilePath === null) {
      return "on";
    }
    const source: Json | undefined =
      system.sourceStore.moduleSource(moduleFilePath);
    return assistantAvailability({
      assistant: readAssistantSettings(source),
    });
  }, [system, sourcesVersion, schemasVersion]);
}
