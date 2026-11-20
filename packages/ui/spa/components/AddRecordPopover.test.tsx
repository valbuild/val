/** @jest-environment jsdom */
import "../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { BasicAddForm } from "./AddRecordPopover";

/**
 * The "Add" form of a record that names its own keys refuses a key the record
 * already has, and only that.
 *
 * It checked `key in existingKeys` against an ARRAY of keys, which asks
 * whether the key is an array INDEX: a key already in the record was
 * accepted (and the add wrote over that entry), and a new key spelled like an
 * index -- "0", "12" -- was refused while the record had that many entries.
 */
describe("BasicAddForm", () => {
  /** Types `key` and answers whether Add is disabled. */
  function typeKey(key: string): boolean {
    fireEvent.change(screen.getByRole("textbox"), { target: { value: key } });
    const button = screen.getByRole("button", { name: "Add" });
    if (!(button instanceof HTMLButtonElement)) throw new Error("not a button");
    return button.disabled;
  }

  test("refuses a key the record already has", () => {
    render(
      <BasicAddForm record={{ ada: null, grace: null }} onSubmit={() => {}} />,
    );
    expect(typeKey("ada")).toBe(true);
  });

  test("accepts a new key, also one spelled like an index", () => {
    render(
      <BasicAddForm record={{ ada: null, grace: null }} onSubmit={() => {}} />,
    );
    expect(typeKey("linus")).toBe(false);
    expect(typeKey("0")).toBe(false);
  });

  test("does not take a key from the object's prototype for the record's", () => {
    render(<BasicAddForm record={{}} onSubmit={() => {}} />);
    expect(typeKey("toString")).toBe(false);
  });
});
