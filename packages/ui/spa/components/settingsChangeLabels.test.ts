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

  test("an unknown path has no label, rather than an invented one", () => {
    // A section from a newer Val than this Studio: the caller falls back to the
    // generic prettifier instead of guessing.
    expect(settingsFieldLabel(path('"locales"."default"'))).toBe(null);
  });
});
