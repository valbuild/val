/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ReviewView } from "./ReviewView";
import { reviewModel } from "./fixtures";

/*
 * The avatars are mocked away, and only because jest cannot load them:
 * `FieldPatchAuthors` imports `ValProvider`, which imports the validation
 * worker, which uses `import.meta`. Same reason `shellDataMapping` is split
 * out from `useShellData`. Nothing here is about the avatars, and a stub keeps
 * that one limitation from deciding whether this page can be tested at all.
 */
jest.mock("../components/FieldPatchAuthors", () => ({
  FieldPatchAuthorsPure: () => null,
}));

/**
 * The selection control is the design system's checkbox, not a native one.
 *
 * This shipped wrong once and the screenshot is why it was caught rather than
 * the types: a bare `<input type="checkbox">` is painted by the browser from
 * `color-scheme`, which nothing sets — Val's dark mode is `[data-mode="dark"]`
 * on a shadow root, and the UA cannot know that. So every UNCHECKED box in the
 * dark theme rendered as a solid white square, indistinguishable from a ticked
 * one, on the one control this page turns on. `accent-color` does not help: it
 * recolours the checked fill and nothing else.
 *
 * Pinned by the ROLE's element rather than by a class, because that is the
 * thing that decides who paints it. Radix's checkbox is a `<button>`; a native
 * one is an `<input>`. Both answer to `role="checkbox"`, so a refactor back to
 * the native element would keep every other query in this file passing.
 */
describe("the row selection checkbox", () => {
  test("is not a native input, so the theme paints it", () => {
    render(
      <ReviewView
        model={reviewModel}
        onCompare={() => undefined}
        onRestore={() => undefined}
        onStage={() => undefined}
        onUnstage={() => undefined}
        onDiscard={() => undefined}
        onDiscardAll={() => undefined}
      />,
    );
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(9);
    for (const box of boxes) {
      expect(box.tagName).not.toBe("INPUT");
    }
  });

  /*
   * And it says which row it selects. Nine identical "Select" labels is the
   * other way this control becomes unusable - to a screen reader it is then a
   * column of nine indistinguishable toggles.
   */
  test("names the row it selects", () => {
    render(
      <ReviewView
        model={reviewModel}
        onCompare={() => undefined}
        onRestore={() => undefined}
        onStage={() => undefined}
        onUnstage={() => undefined}
        onDiscard={() => undefined}
        onDiscardAll={() => undefined}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select Kim Midtlid" }),
    ).not.toBeNull();
  });
});
