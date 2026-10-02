/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { CompareDialog } from "./CompareDialog";
import { TooltipProvider } from "../components/designSystem/tooltip";
import { compareModel } from "./fixtures";
import type { CompareFocus, CompareModel, CompareNavNode } from "./types";

/*
 * Mocked for the reason `reviewCheckbox.test.tsx` gives: the avatars import
 * `ValProvider`, which imports a worker jest cannot load. Nothing here is about
 * the avatars.
 */
jest.mock("../components/FieldPatchAuthors", () => ({
  FieldPatchAuthorsPure: () => null,
}));
/*
 * No shadow root to portal into, so popups render in place — the fallback the
 * design system takes while the portal node has not arrived yet.
 */
jest.mock("../components/ValPortalProvider", () => ({
  useValPortal: () => null,
}));

function dialog(model: CompareModel, focus: CompareFocus | null) {
  return (
    <TooltipProvider>
      <CompareDialog
        open
        onOpenChange={() => undefined}
        model={model}
        forceLayout="desktop"
        now={new Date("2026-10-01T12:00:00Z")}
        focus={focus}
      />
    </TooltipProvider>
  );
}

/** Every pane id the nav lists, in the order it lists them. */
function paneIdsInNavOrder(model: CompareModel): string[] {
  const out: string[] = [];
  const walk = (nodes: CompareNavNode[]): void => {
    for (const node of nodes) {
      if (model.panes[node.id] !== undefined) out.push(node.id);
      walk(node.children ?? []);
    }
  };
  for (const section of model.sections) walk(section.nodes);
  return out;
}

/** Whether the selected pane's heading names this pane. */
function showsPane(model: CompareModel, paneId: string): boolean {
  const title = model.panes[paneId].description.title;
  return screen
    .getAllByRole("heading", { level: 2 })
    .some((heading) => heading.textContent === title);
}

describe("the compare dialog's focus", () => {
  const [first, ...rest] = paneIdsInNavOrder(compareModel);
  const later = rest[rest.length - 1];

  test("is the first change when there is none", () => {
    render(dialog(compareModel, null));
    expect(showsPane(compareModel, first)).toBe(true);
  });

  test("opens the pane a link named", () => {
    render(dialog(compareModel, { paneId: later, rowId: null }));
    expect(showsPane(compareModel, later)).toBe(true);
    expect(showsPane(compareModel, first)).toBe(false);
  });

  /*
   * A focus on a pane the model does not have yet — schemas still loading, so
   * a page is still filed under its module — must not open onto "Nothing
   * selected". The first change stands in until the pane appears.
   */
  test("falls back to the first change while its pane does not exist", () => {
    const { rerender } = render(
      dialog(compareModel, { paneId: "node:/not/yet.val.ts", rowId: null }),
    );
    expect(showsPane(compareModel, first)).toBe(true);

    const arrived: CompareModel = {
      ...compareModel,
      panes: {
        ...compareModel.panes,
        "node:/not/yet.val.ts": compareModel.panes[later],
      },
    };
    rerender(dialog(arrived, { paneId: "node:/not/yet.val.ts", rowId: null }));
    expect(showsPane(compareModel, later)).toBe(true);
  });

  test("marks the row a link named", () => {
    const pane = compareModel.panes[later];
    const group = pane.groups[0];
    const rowId = group.rows[group.rows.length - 1].id;
    render(dialog(compareModel, { paneId: later, rowId }));
    const row = document.querySelector<HTMLElement>(
      `[data-compare-row="${rowId}"]`,
    );
    expect(row).not.toBeNull();
    expect(row?.classList.contains("val-scroll-highlight")).toBe(true);
  });
});
