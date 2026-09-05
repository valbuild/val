import { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { resolveSettingsModule } from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";

/**
 * What the settings module says about the assistant.
 *
 * Read out of a module's SOURCE, which arrives as `Json`, so every field is
 * checked rather than asserted: a settings module is a file someone edits, and
 * a hand-written one can hold anything the schema has not yet rejected.
 */
export type AssistantSettings = {
  /** Three states, not two — see `assistantAvailability`. */
  enabled: boolean | null;
  context: string | null;
  tone: string | null;
};

export const NO_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: null,
  context: null,
  tone: null,
};

function stringOrNull(value: Json | undefined): string | null {
  // An empty string is unset: it would otherwise be handed to the model as an
  // instruction with nothing in it.
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Reads the `assistant` section out of a settings module's source. */
export function readAssistantSettings(source: Json | undefined) {
  if (typeof source !== "object" || source === null || isJsonArray(source)) {
    return NO_ASSISTANT_SETTINGS;
  }
  const assistant = source["assistant"];
  if (
    typeof assistant !== "object" ||
    assistant === null ||
    isJsonArray(assistant)
  ) {
    return NO_ASSISTANT_SETTINGS;
  }
  return {
    enabled:
      typeof assistant["enabled"] === "boolean" ? assistant["enabled"] : null,
    context: stringOrNull(assistant["context"]),
    tone: stringOrNull(assistant["tone"]),
  };
}

/**
 * The project's settings module, from the schemas the Studio holds.
 *
 * `null` when the project has none, and also when it has two of them or one in
 * a subdirectory: `resolveSettingsModule` refuses to pick a winner, and the
 * assistant is the last place that should be quietly guessing which settings
 * are the project's.
 */
export function settingsModuleFilePath(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): ModuleFilePath | null {
  return resolveSettingsModule(schemas).moduleFilePath;
}

/**
 * The project's context and tone of voice, as a system prompt section.
 *
 * Empty string when the project has said neither, so the prompt does not carry
 * a heading with nothing under it — a section that says "nothing here" is
 * something the model has to interpret.
 *
 * Sent with EVERY message rather than only the first: the system prompt travels
 * with each prompt anyway, and a long conversation that had been told the tone
 * once would drift off it.
 */
export function assistantSettingsPromptSection(
  settings: AssistantSettings,
): string {
  const parts: string[] = [];
  if (settings.context) {
    parts.push(
      `The person who set this project up wrote this about it:\n\n${settings.context}`,
    );
  }
  if (settings.tone) {
    parts.push(
      `They asked for content to be written in this tone of voice:\n\n${settings.tone}\n\nThat applies to content you write or rewrite — not to what you say to the editor in the chat, which stays plain and brief.`,
    );
  }
  if (parts.length === 0) {
    return "";
  }
  return `\n\n## This project\nThese are the project's own settings, edited under Settings in the Studio. Treat them as standing instructions from the project's owners, and as context rather than as content to repeat back.\n\n${parts.join(
    "\n\n",
  )}`;
}
