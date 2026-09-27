/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ReviewView, accessibleRowName } from "./ReviewView";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { reviewModel } from "./fixtures";
import type { ReviewRow } from "./types";

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
/*
 * `ValProvider` mounts a `TooltipProvider` in the Studio; a test mounts no
 * provider at all, and Radix throws rather than degrading — which is how the
 * section headings' info tooltips broke this file the moment they were added.
 */
function review() {
  return (
    <TooltipProvider>
      <ReviewView
        model={reviewModel}
        onCompare={() => undefined}
        onRestore={() => undefined}
        onStage={() => undefined}
        onUnstage={() => undefined}
        onDiscard={() => undefined}
        onDiscardAll={() => undefined}
      />
    </TooltipProvider>
  );
}

describe("the row selection checkbox", () => {
  test("is not a native input, so the theme paints it", () => {
    render(review());
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
    render(review());
    // The name AND the trail: "Kim Midtlid" is the preview, `kimmid` the key
    // it is stored under, and a row is told apart from its neighbours by the
    // second when two of them share the first. See `accessibleRowName`.
    expect(
      screen.getByRole("checkbox", { name: "Select Kim Midtlid, kimmid" }),
    ).not.toBeNull();
  });

  /*
   * Every one of them differently, which is the claim the test above does not
   * make. The title alone distinguishes a row whose module gave it a preview
   * and nothing else: two `title` fields in one array are both called "title",
   * and the visible list tells them apart with the trail that the accessible
   * name left out. Asserted over the whole column rather than on one pair, so
   * a row added later cannot quietly reintroduce a duplicate.
   */
  test("names every row differently", () => {
    render(review());
    const names = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label"));
    expect(names.every((name) => name !== null && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});

/*
 * The name itself, away from the render: these are the shapes that collide,
 * and they are cheaper to state than to build a fixture for.
 *
 * Built by overriding a REAL fixture row rather than by asserting a literal
 * into shape, so a field added to `ReviewRow` cannot leave these cases
 * type-checking against a row the page would never be handed.
 */
describe("accessibleRowName", () => {
  const base = reviewModel.modules[0].rows[0];
  function row(title: string, trail: string[]): ReviewRow {
    return {
      ...base,
      trail,
      description: { ...base.description, title },
    };
  }

  test("says the trail, deepest first, so two like rows differ", () => {
    expect(accessibleRowName(row("title", ["items", "0", "title"]))).toBe(
      "Select title in 0 in items",
    );
    expect(accessibleRowName(row("title", ["items", "1", "title"]))).toBe(
      "Select title in 1 in items",
    );
  });

  test("does not say a preview name twice", () => {
    expect(
      accessibleRowName(row("Kim Midtlid", ["authors", "Kim Midtlid"])),
    ).toBe("Select Kim Midtlid in authors");
  });

  test("names a module-level row as the whole module", () => {
    expect(accessibleRowName(row("Authors", []))).toBe(
      "Select Authors, the whole module",
    );
  });
});
