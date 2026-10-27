import { useMemo } from "react";
import { assistantAvailability, AssistantAvailability } from "@valbuild/core";
import { System } from "../stores/createSystem";
import { useValSystem } from "../stores/react/SystemContext";
import { readAssistantSettings } from "./assistantSettings";
import { useSettingsModuleSourceOf } from "./useSettingsModuleSource";

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
 * a shortcut around them — see `useSettingsModuleSourceOf`, which is what every
 * reader of `s.settings()` shares.
 */
export function useAssistantAvailabilityOf(
  system: System | null,
): AssistantAvailability {
  const { moduleFilePath, source } = useSettingsModuleSourceOf(system);
  return useMemo((): AssistantAvailability => {
    // No settings module at all — including while the schemas load — is "on",
    // for the reason in the doc comment above. A module that EXISTS but whose
    // source has not arrived is not that case: it is read as it stands, which
    // is "unconfigured", so the answer does not flip once it lands.
    if (moduleFilePath === null) {
      return "on";
    }
    return assistantAvailability({ assistant: readAssistantSettings(source) });
  }, [moduleFilePath, source]);
}
