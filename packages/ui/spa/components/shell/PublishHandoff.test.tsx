/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { PublishHandoffCard } from "./PublishHandoff";

/**
 * A failed hand-off offers the Studio as the way on -- except where the Studio
 * would fail the same way, and a button there leads to the same error again.
 */
test("a failed hand-off offers the Studio", () => {
  render(
    <PublishHandoffCard
      state={{ kind: "failed", message: "The tab stopped answering." }}
      onOpenStudio={() => undefined}
    />,
  );
  expect(screen.getByRole("button", { name: /Open the Studio/ })).toBeTruthy();
});

test("one the Studio cannot help with does not", () => {
  render(
    <PublishHandoffCard
      state={{
        kind: "failed",
        message:
          "This browser would not let Val hand the publish to a new tab.",
        studioCannotHelp: true,
      }}
      onOpenStudio={() => undefined}
    />,
  );
  expect(screen.queryByRole("button", { name: /Open the Studio/ })).toBeNull();
});
