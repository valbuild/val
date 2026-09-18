import { ModulePath } from "@valbuild/core";
import {
  SETTINGS_MODULE_TITLE,
  settingsFieldLabel,
} from "./settingsChangeLabels";

/** The branded type the real caller has, from `splitModuleFilePathAndModulePath`. */
const path = (modulePath: string) => modulePath as ModulePath;

describe("settingsFieldLabel", () => {
  test("the module itself is Settings, not its filename", () => {
    expect(settingsFieldLabel(path(""))).toBe(SETTINGS_MODULE_TITLE);
  });

  test("uses the words the panel uses", () => {
    // The publish diff and the panel have to agree: "Tone of voice" is what the
    // editor typed into, so "Ai / Tone" would read as a different field.
    expect(settingsFieldLabel(path('"assistant"."tone"'))).toBe(
      "Assistant · Tone of voice",
    );
    expect(settingsFieldLabel(path('"assistant"."context"'))).toBe(
      "Assistant · Context",
    );
    expect(settingsFieldLabel(path('"assistant"."enabled"'))).toBe(
      "Assistant · Enabled",
    );
    expect(settingsFieldLabel(path('"assistant"'))).toBe("Assistant");
  });

  test("the locales list is named the way the tab names it", () => {
    // "Languages" is the tab's own word — "No languages yet", "Add a language".
    // `available` is the key, and reviewing a change as "Locales / Available"
    // names something the editor never read.
    expect(settingsFieldLabel(path('"locales"."available"'))).toBe(
      "Locales · Languages",
    );
    expect(settingsFieldLabel(path('"locales"'))).toBe("Locales");
  });

  test("an unknown path has no label, rather than an invented one", () => {
    // A section from a newer Val than this Studio: the caller falls back to the
    // generic prettifier instead of guessing.
    expect(settingsFieldLabel(path('"publishing"."schedule"'))).toBe(null);
  });
});
