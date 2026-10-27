/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { CompareDialog } from "./CompareDialog";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { compareModel } from "./fixtures";
import type { ComparePageView } from "./types";

// See `compareDialogFocus.test.tsx` for why these two are mocked.
jest.mock("../components/FieldPatchAuthors", () => ({
  FieldPatchAuthorsPure: () => null,
}));
jest.mock("../components/ValPortalProvider", () => ({
  useValPortal: () => null,
}));

function dialog(
  paneId: string,
  renderPage?: (page: ComparePageView) => React.ReactNode,
) {
  return (
    <TooltipProvider>
      <CompareDialog
        open
        onOpenChange={() => undefined}
        model={compareModel}
        forceLayout="desktop"
        now={new Date("2026-10-01T12:00:00Z")}
        focus={{ paneId, rowId: null }}
        {...(renderPage ? { renderPage } : {})}
      />
    </TooltipProvider>
  );
}

function drawn(page: ComparePageView) {
  return (
    <div data-testid={`page-${page.side}`}>
      {page.side} {page.url} {page.device}
    </div>
  );
}

describe("comparing a page as a page", () => {
  test("is not offered by a caller that cannot draw one", () => {
    render(dialog("page-landing"));
    expect(screen.queryByRole("group", { name: "Compare as" })).toBeNull();
  });

  test("draws both sides of the page, at the same width", () => {
    render(dialog("page-landing", drawn));
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    expect(screen.getByTestId("page-left").textContent).toBe("left / desktop");
    expect(screen.getByTestId("page-right").textContent).toBe(
      "right / desktop",
    );

    fireEvent.click(screen.getByRole("button", { name: "Phone width" }));
    expect(screen.getByTestId("page-left").textContent).toBe("left / mobile");
    expect(screen.getByTestId("page-right").textContent).toBe("right / mobile");
  });

  test("goes back to the fields", () => {
    render(dialog("page-landing", drawn));
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    fireEvent.click(screen.getByRole("button", { name: "Fields" }));
    expect(screen.queryByTestId("page-left")).toBeNull();
  });

  test("does not load a new page on the side it is not on", () => {
    render(dialog("page-new-blog", drawn));
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    expect(screen.queryByTestId("page-left")).toBeNull();
    expect(screen.getByText("Not here yet: this page is new.")).toBeTruthy();
    expect(screen.getByTestId("page-right").textContent).toBe(
      "right /blogs/history-restore desktop",
    );
  });

  test("does not load a removed page on the side it is not on", () => {
    render(dialog("page-removed-blog", drawn));
    fireEvent.click(screen.getByRole("button", { name: "Page" }));
    expect(screen.getByTestId("page-left")).toBeTruthy();
    expect(screen.queryByTestId("page-right")).toBeNull();
  });

  test("is not offered for something that is not a page", () => {
    render(dialog("mod-authors", drawn));
    expect(screen.queryByRole("group", { name: "Compare as" })).toBeNull();
  });
});
