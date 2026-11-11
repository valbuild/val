/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import { Sketchpad } from "./Sketchpad";
import { SketchpadWorkspace } from "./SketchpadWorkspace";
import { PaneTabsProvider } from "../shell/workspace/PaneTabs";
import { SideTabs } from "../shell/workspace/WorkspaceChrome";

/**
 * Sketch's header while it shares a column with the Assistant (the plan's
 * "Sketch and Assistant's header"): Build on the left, the tabs on the
 * right, in one row -- not a row of tabs above a header of its own.
 */
const tabs = (
  <SideTabs tabs={["sketch", "chat"]} front="sketch" onChange={() => {}} />
);
const sketch = (
  <Sketchpad
    value={"# A page\n"}
    onChange={() => {}}
    title="A page"
    onAskAssistant={() => {}}
    assistantStatus="changed"
  />
);

describe("Sketch's header", () => {
  test("as a tab: Build and the tabs share a row", () => {
    render(<PaneTabsProvider tabs={tabs}>{sketch}</PaneTabsProvider>);
    const tablist = screen.getByRole("tablist", {
      name: "Sketch and Assistant",
    });
    const row = tablist.parentElement;
    if (row === null) throw new Error("expected the tabs in a row");
    expect(within(row).getByRole("button", { name: /Build/ })).toBeTruthy();
    // Once: the title's row no longer has a Build of its own.
    expect(screen.getAllByRole("button", { name: /Build/ })).toHaveLength(1);
  });

  test("in a column of its own: no tabs, Build beside the name", () => {
    render(sketch);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Build/ })).toHaveLength(1);
  });

  test("with no sketch open, the list keeps the tabs", () => {
    render(
      <PaneTabsProvider tabs={tabs}>
        <SketchpadWorkspace
          sketchpad={null}
          sketchpads={{
            sketchpads: [],
            onOpen: () => {},
            onReopen: () => {},
          }}
        />
      </PaneTabsProvider>,
    );
    expect(
      screen.getByRole("tablist", { name: "Sketch and Assistant" }),
    ).toBeTruthy();
  });
});
