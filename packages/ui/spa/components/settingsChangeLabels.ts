import { Internal } from "@valbuild/core";

/**
 * What a settings module is called where a module name is shown.
 *
 * Not its filename. Every other module is named after its file because that is
 * what the project called it, but a settings module's path is fixed by Val —
 * calling the card "settings" tells the reader nothing they did not know from
 * the fact that they are looking at settings.
 */
export const SETTINGS_MODULE_TITLE = "Settings";

/**
 * The label the Settings panel uses for a field, by its module path.
 *
 * The publish diff and the panel have to agree: someone who changed "Tone of
 * voice" and then opened Review should see "Tone of voice", not "Ai / Tone".
 * The generic prettifier cannot do this — it has no idea that `tone` is
 * labelled with the longer name the panel gives it, or that a section's rows
 * are read with the section's name in front of them.
 *
 * `null` for a path this does not know, which is the honest answer for a
 * section added by a newer Val than the Studio looking at it: the caller falls
 * back to the generic label rather than inventing one.
 */
export function settingsFieldLabel(modulePath: string): string | null {
  if (!modulePath) {
    return SETTINGS_MODULE_TITLE;
  }
  const segments = Internal.splitModulePath(
    modulePath as Parameters<typeof Internal.splitModulePath>[0],
  );
  const label = LABELS[segments.join(".")];
  return label ?? null;
}

/**
 * Keyed by dotted module path, and deliberately written out rather than derived
 * from the schema: these are the words on the panel, and the panel is where a
 * change to them belongs.
 */
const LABELS: Record<string, string> = {
  assistant: "Assistant",
  "assistant.enabled": "Assistant · Enabled",
  "assistant.context": "Assistant · Context",
  "assistant.tone": "Assistant · Tone of voice",
};
