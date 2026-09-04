import {
  SETTINGS_MODULE_TITLE,
  settingsFieldLabel,
} from "./settingsChangeLabels";

describe("settingsFieldLabel", () => {
  test("the module itself is Settings, not its filename", () => {
    expect(settingsFieldLabel("")).toBe(SETTINGS_MODULE_TITLE);
  });

  test("uses the words the panel uses", () => {
    // The publish diff and the panel have to agree: "Tone of voice" is what the
    // editor typed into, so "Ai / Tone" would read as a different field.
    expect(settingsFieldLabel('"ai"."tone"')).toBe("AI · Tone of voice");
    expect(settingsFieldLabel('"ai"."context"')).toBe("AI · Context");
    expect(settingsFieldLabel('"ai"."enabled"')).toBe("AI · Assistant");
    expect(settingsFieldLabel('"ai"')).toBe("AI");
  });

  test("an unknown path has no label, rather than an invented one", () => {
    // A section from a newer Val than this Studio: the caller falls back to the
    // generic prettifier instead of guessing.
    expect(settingsFieldLabel('"locales"."default"')).toBe(null);
  });
});
