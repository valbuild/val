/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ASSISTANT_SETTINGS_MAX_LENGTH } from "@valbuild/core";
import {
  AssistantSettingsFields,
  SettingsTabs,
  StudioSettingsFields,
  ThemeSettingsFields,
} from "./SettingsPanel";
import { AppWindow } from "lucide-react";

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

/**
 * The tab strip, which has to survive more tabs than fit.
 *
 * The panel is 360px and a tab is as wide as its label, so four of them
 * overflowed — and an overflowing flex row does not wrap, it squashes: the last
 * tab was clipped with nothing to reach it by. Two rules keep that from coming
 * back, and neither is visible in a screenshot of a panel that currently fits.
 */
describe("the settings tabs", () => {
  const tab = (id: string, label: string) => ({
    id,
    label,
    icon: AppWindow,
    content: <div>{label} content</div>,
  });

  test("the strip scrolls sideways rather than clipping", () => {
    const { container } = render(
      <SettingsTabs
        tabs={[
          tab("a", "Assistant"),
          tab("b", "Studio"),
          tab("c", "Locales"),
          tab("d", "Permissions"),
        ]}
      />,
    );
    const strip = screen.getByRole("tablist");
    expect(strip.parentElement?.className).toContain("overflow-x-auto");
    // Every tab keeps its width: without this the flex row squashes them to fit
    // and the scroller has nothing to scroll.
    for (const button of container.querySelectorAll('[role="tab"]')) {
      expect(button.className).toContain("shrink-0");
    }
  });

  test("shows the selected tab's content and only that", () => {
    render(<SettingsTabs tabs={[tab("a", "Assistant"), tab("b", "Studio")]} />);
    expect(screen.queryByText("Assistant content")).not.toBeNull();
    expect(screen.queryByText("Studio content")).toBeNull();
  });
});

/**
 * Appearance and the tour share the Studio tab, as two named sections. Two
 * schema sections is not a reason to be two tabs — a tab is a place to look,
 * and "how the Studio looks and behaves here" is one place.
 */
describe("the Studio tab's sections", () => {
  test("each says which section it is", () => {
    render(
      <>
        <ThemeSettingsFields
          value={{ accent: null, radius: null, mode: null }}
          onChange={() => undefined}
        />
        <StudioSettingsFields
          value={{ tour: null }}
          onChange={() => undefined}
        />
      </>,
    );
    expect(screen.queryByText("Appearance")).not.toBeNull();
    expect(screen.queryByText("Tour")).not.toBeNull();
  });
});

/**
 * `studio.commitMessage`: off (unset, or "automatic") publishes without asking;
 * on writes "required".
 */
describe("the commit message switch", () => {
  function commitSwitch() {
    return screen.getByRole("switch", { name: /Ask for a commit message/ });
  }

  test("unset draws as off, because unset means automatic", () => {
    render(
      <StudioSettingsFields
        value={{ tour: null }}
        onChange={() => undefined}
      />,
    );
    expect(commitSwitch().getAttribute("data-state")).toBe("unchecked");
  });

  test("turning it on writes 'required', and off writes 'automatic'", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <StudioSettingsFields
        value={{ tour: null, commitMessage: null }}
        onChange={onChange}
      />,
    );
    fireEvent.click(commitSwitch());
    expect(onChange).toHaveBeenLastCalledWith("commitMessage", "required");
    rerender(
      <StudioSettingsFields
        value={{ tour: null, commitMessage: "required" }}
        onChange={onChange}
      />,
    );
    expect(commitSwitch().getAttribute("data-state")).toBe("checked");
    fireEvent.click(commitSwitch());
    expect(onChange).toHaveBeenLastCalledWith("commitMessage", "automatic");
  });
});
