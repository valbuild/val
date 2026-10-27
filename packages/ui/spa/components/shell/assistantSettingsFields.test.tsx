/** @jest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { ASSISTANT_SETTINGS_MAX_LENGTH } from "@valbuild/core";
import {
  AssistantSettingsFields,
  AssistantSettingsValue,
} from "./SettingsPanel";

/**
 * The Assistant tab's two prose fields: which order they are in, and when the
 * empty one offers to fill itself.
 *
 * Both are rules about the panel rather than about the schema, so nothing else
 * can hold them. The order is the panel's choice — tone is what an editor comes
 * here to write — and the button's condition is the part that is easy to get
 * wrong in a way nobody notices: an overwrite button on a filled field, in a
 * panel with no undo.
 */
const UNSET: AssistantSettingsValue = {
  enabled: true,
  context: null,
  tone: null,
};

function renderFields(
  value: Partial<AssistantSettingsValue>,
  props: {
    onGenerateTone?: () => void;
    readonly?: boolean;
    errors?: Partial<Record<keyof AssistantSettingsValue, string>>;
  } = {},
) {
  cleanup();
  render(
    <AssistantSettingsFields
      value={{ ...UNSET, ...value }}
      onChange={() => undefined}
      maxLength={ASSISTANT_SETTINGS_MAX_LENGTH}
      {...props}
    />,
  );
}

const generateButton = (): HTMLButtonElement | null => {
  const button = screen.queryByRole("button", {
    name: "Generate from my content",
  });
  // By its accessible NAME, not its text, and that is the point of asking this
  // way: the button used to live inside the field's wrapping `<label>`, where
  // the label's own text won the name computation and it was announced as
  // "Tone of voice, button". The text was right on screen the whole time.
  return button instanceof HTMLButtonElement ? button : null;
};

describe("AssistantSettingsFields", () => {
  test("tone of voice comes before context", () => {
    renderFields({});
    const labels = screen
      .getAllByText(/^(Tone of voice|Context)$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(["Tone of voice", "Context"]);
  });

  test("an empty tone of voice offers to generate itself", () => {
    renderFields({}, { onGenerateTone: () => undefined });
    expect(generateButton()).not.toBeNull();
  });

  test("whitespace is still empty", () => {
    renderFields({ tone: "   \n " }, { onGenerateTone: () => undefined });
    expect(generateButton()).not.toBeNull();
  });

  test("a tone of voice that somebody wrote is not offered an overwrite", () => {
    // The rule this test exists for. There is no undo in a settings panel, so
    // a button that replaces a paragraph an editor wrote is a button that
    // loses it. Clearing the field brings the offer back.
    renderFields(
      { tone: "Plain and direct." },
      { onGenerateTone: () => undefined },
    );
    expect(generateButton()).toBeNull();
  });

  test("no button when there is no assistant to ask", () => {
    // `onGenerateTone` is absent when the chat cannot take a message — an
    // assistant that is off, or offline, or a layout with no chat surface. The
    // button is not drawn at all rather than drawn and dead.
    renderFields({});
    expect(generateButton()).toBeNull();
  });

  test("the button is disabled on a readonly settings module", () => {
    renderFields({}, { onGenerateTone: () => undefined, readonly: true });
    expect(generateButton()?.disabled).toBe(true);
  });

  test("the button is disabled when the assistant is explicitly off", () => {
    // Both prose fields go disabled in that state, and a button that fills one
    // of them has to go with them.
    renderFields({ enabled: false }, { onGenerateTone: () => undefined });
    expect(generateButton()?.disabled).toBe(true);
  });

  test("pressing it asks, and does not focus the field instead", () => {
    // A label forwards its clicks to its control, so while this button was
    // inside the field's wrapping label a press put the caret in the very box
    // it was about to fill. It is a sibling of the label now.
    const asked: number[] = [];
    renderFields({}, { onGenerateTone: () => asked.push(1) });
    const button = generateButton();
    expect(button).not.toBeNull();
    button?.click();
    expect(asked).toEqual([1]);
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  test("the field is named by its label and described by its description", () => {
    // The other half of moving off a wrapping `<label>`. Everything inside one
    // names the control, so the box used to be called "Tone of voice How it
    // should write: formal or playful, British or American, how headings are
    // cased." — a name that is a paragraph, read out in full every time the
    // field is focused.
    renderFields({});
    const box = screen.getByRole("textbox", { name: "Tone of voice" });
    const describedBy = box.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const description =
      describedBy === null ? null : document.getElementById(describedBy);
    expect(description?.textContent).toContain("formal or playful");
  });

  test("a validation message is part of what describes the field", () => {
    renderFields(
      { tone: "x" },
      { errors: { tone: "Too long by 40 characters" } },
    );
    const box = screen.getByRole("textbox", { name: "Tone of voice" });
    expect(box.getAttribute("aria-invalid")).toBe("true");
    const ids = box.getAttribute("aria-describedby")?.split(" ") ?? [];
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain("Too long by 40 characters");
  });
});
