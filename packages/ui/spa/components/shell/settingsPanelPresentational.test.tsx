/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ASSISTANT_SETTINGS_MAX_LENGTH } from "@valbuild/core";
import { AssistantSettingsFields, ThemeSettingsFields } from "./SettingsPanel";

/**
 * That the settings panel can be rendered on its own at all.
 *
 * A strange thing to assert until it stops being true. `SettingsPanel` is
 * documented as presentational — the connected half is `ValSettingsSections`,
 * and Storybook renders these same components with local state — but "does not
 * READ a store" and "does not IMPORT one" are different claims, and only the
 * second one is what makes the file renderable in a test.
 *
 * The Appearance tab broke it: it needs a colour picker, and `ColorField.tsx`
 * exports the store-connected field beside the pure one, which reaches
 * `Preview` and through it the whole editor tree down to `ValProvider`. The
 * panel still worked in the app and in Storybook, and every jest test that
 * touched it died on a `require` of ESM several layers down. Hence
 * `ColorFieldPure.tsx`, and hence this test: it fails the moment a store,
 * provider or connected field is imported here again.
 */
describe("the settings panel is renderable without any Val plumbing", () => {
  test("the assistant's fields", () => {
    render(
      <AssistantSettingsFields
        value={{ enabled: true, context: null, tone: null }}
        onChange={() => undefined}
        maxLength={ASSISTANT_SETTINGS_MAX_LENGTH}
      />,
    );
    expect(screen.queryByText("Tone of voice")).not.toBeNull();
  });

  test("the appearance fields, colour picker included", () => {
    render(
      <ThemeSettingsFields
        value={{ accent: "#2563eb", radius: "tight", mode: null }}
        onChange={() => undefined}
      />,
    );
    expect(screen.queryByLabelText("Val green")).not.toBeNull();
    // The colour input is the part that pulled the editor tree in.
    expect(screen.queryByLabelText("Color picker")).not.toBeNull();
  });
});
