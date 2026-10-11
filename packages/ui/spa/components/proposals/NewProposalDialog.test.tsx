/** @jest-environment jsdom */
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { NewProposalDialog } from "./NewProposalDialog";

/*
 * The name starts as a suggestion, selected so typing replaces it. Only the
 * suggestion: a name someone has typed is theirs, and tabbing away and back
 * must not select it, or the next key wipes it.
 */
describe("NewProposalDialog's name", () => {
  const dialog = () =>
    render(
      <NewProposalDialog
        open
        onOpenChange={() => {}}
        onCreate={() => {}}
        onOpenExisting={() => {}}
        suggestedName="Bright harbour"
      />,
    );
  const nameField = (): HTMLInputElement => {
    const field = screen.getByDisplayValue(/./, { exact: false });
    if (!(field instanceof HTMLInputElement)) throw new Error("no name field");
    return field;
  };
  const selected = (field: HTMLInputElement) =>
    field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);

  test("starts as the suggestion, focused and selected", () => {
    dialog();
    const field = nameField();
    expect(field.value).toBe("Bright harbour");
    expect(document.activeElement).toBe(field);
    expect(selected(field)).toBe("Bright harbour");
  });

  test("an edited name is not selected again when the field is focused again", () => {
    dialog();
    const field = nameField();
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Spring campaign" } });
    field.setSelectionRange(field.value.length, field.value.length);
    fireEvent.blur(field);
    fireEvent.focus(field);
    expect(field.value).toBe("Spring campaign");
    expect(selected(field)).toBe("");
  });
});
