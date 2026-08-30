/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PanelRow } from "./PanelPrimitives";

/**
 * What a panel row is called.
 *
 * The badges — the unpublished-changes dot and the validation-error count — used
 * to sit inside the row's own button carrying only a `title`, which made them
 * part of its accessible NAME. The home page announced itself as
 * "/ Unpublished changes", and as "/1" once it had a validation error: a screen
 * reader read the row's state as part of the page's name, and every
 * `getByRole("button", { name, exact: true })` in the e2e suite silently stopped
 * matching the moment someone edited that page — which is exactly how it was
 * found, twice, as two unrelated-looking flakes.
 */
describe("a panel row", () => {
  test("is named by its label alone", () => {
    render(<PanelRow label="/" />);
    expect(screen.getByRole("button", { name: "/" })).not.toBeNull();
  });

  test("keeps that name when it has unpublished changes", () => {
    render(<PanelRow label="/" hasDraft />);
    expect(screen.getByRole("button", { name: "/" })).not.toBeNull();
  });

  test("keeps that name when it has validation errors", () => {
    render(<PanelRow label="/" errorCount={2} />);
    expect(screen.getByRole("button", { name: "/" })).not.toBeNull();
  });

  test("says what its badges mean, as a description", () => {
    render(<PanelRow label="/" hasDraft errorCount={1} />);
    const row = screen.getByRole("button", { name: "/" });
    const describedBy = row.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const description = document.getElementById(describedBy ?? "");
    // Both, in the order they are drawn.
    expect(description?.textContent).toBe(
      "Unpublished changes, 1 validation error",
    );
  });

  test("and points at nothing when there is nothing to say", () => {
    render(<PanelRow label="/" />);
    expect(
      screen
        .getByRole("button", { name: "/" })
        .getAttribute("aria-describedby"),
    ).toBeNull();
  });

  test("pluralises the error count", () => {
    render(<PanelRow label="/" errorCount={3} />);
    const row = screen.getByRole("button", { name: "/" });
    const description = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toBe("3 validation errors");
  });
});
