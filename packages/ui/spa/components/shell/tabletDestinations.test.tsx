/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { NavSwitcher, needsNavSwitcher } from "./NavSwitcher";
import { DataPanel } from "./DataPanel";
import { ShellBreakpoint, ShellDataModule, ShellDestination } from "./types";

/**
 * Getting from one destination to another between 768px and 1200px.
 *
 * The left rail is desktop-only and the top bar's menu button opens the FIRST
 * destination a project has and nothing else, so at an iPad's width — or a
 * half screen — Data, Media and Settings had no route at all once Pages was
 * open: whichever panel was showing was the only panel reachable. The switcher
 * that stands in for the rail was gated on `breakpoint === "mobile"`, and the
 * tablet breakpoint fell through the gap between the two.
 *
 * `Shell` itself is not renderable here — it pulls in the whole editor tree —
 * so what is pinned is the rule it asks (`needsNavSwitcher`) and that a panel
 * handed the switcher at tablet width actually shows it.
 */
const destinations: ShellDestination[] = ["pages", "media", "data", "settings"];

const dataModule: ShellDataModule = {
  id: "/content/settings.val.ts" as ModuleFilePath,
  name: "settings",
  moduleFilePath: "/content/settings.val.ts" as ModuleFilePath,
};

function switcher(props: Partial<Parameters<typeof NavSwitcher>[0]> = {}) {
  return (
    <NavSwitcher
      openPanel="data"
      onSelect={() => undefined}
      destinations={destinations}
      {...props}
    />
  );
}

/**
 * The Data panel as the shell renders it, switcher and all.
 *
 * The `navSwitcher` expression is `Shell`'s, copied rather than imported
 * because `Shell` pulls in the whole editor tree — so the thing that has to
 * stay true is that this is the same expression. It is the whole of the bug
 * the empty-band tests below are about.
 */
function dataPanel(
  breakpoint: ShellBreakpoint,
  available: ShellDestination[] = destinations,
) {
  return (
    <DataPanel
      breakpoint={breakpoint}
      data={[dataModule]}
      selectedId={null}
      onSelect={() => undefined}
      onClose={() => undefined}
      navSwitcher={
        needsNavSwitcher(breakpoint, available)
          ? switcher({ openPanel: "data", destinations: available })
          : undefined
      }
    />
  );
}

describe("which breakpoints need the switcher", () => {
  test("tablet does - it has no rail and no other way across", () => {
    expect(needsNavSwitcher("tablet")).toBe(true);
  });

  test("mobile does, as it always did", () => {
    expect(needsNavSwitcher("mobile")).toBe(true);
  });

  test("desktop does not - the rail is the switcher there", () => {
    expect(needsNavSwitcher("desktop")).toBe(false);
  });

  /**
   * The predicate has to agree with what the switcher will actually render.
   *
   * `FloatingPanel` gives any subheader it is handed its own bordered band, so
   * a `true` here for a project the switcher renders `null` for is an empty
   * band under the panel header — a hairline and a row of padding around
   * nothing.
   */
  test("a project with one destination does not - there is no choice", () => {
    expect(needsNavSwitcher("tablet", ["data"])).toBe(false);
    expect(needsNavSwitcher("mobile", ["data"])).toBe(false);
  });

  test("a project with no destinations at all does not either", () => {
    expect(needsNavSwitcher("tablet", [])).toBe(false);
  });

  test("two is a choice, and gets one", () => {
    expect(needsNavSwitcher("tablet", ["pages", "data"])).toBe(true);
  });

  test("agrees with the switcher on every project shape", () => {
    const shapes: ShellDestination[][] = [
      [],
      ["data"],
      ["pages", "data"],
      ["pages", "media", "data", "settings"],
    ];
    for (const available of shapes) {
      const { unmount } = render(switcher({ destinations: available }));
      const rendersSomething = screen.queryByRole("tablist") !== null;
      expect(needsNavSwitcher("tablet", available)).toBe(rendersSomething);
      unmount();
    }
  });
});

describe("the switcher itself", () => {
  test("offers every destination the project has", () => {
    render(switcher());
    for (const name of ["Pages", "Media", "Data", "Settings"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeNull();
    }
  });

  test("marks the open panel, so the others read as somewhere to go", () => {
    render(switcher());
    expect(
      screen.getByRole("tab", { name: "Data" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Pages" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  test("selects the destination it is asked for", () => {
    const selected: string[] = [];
    render(switcher({ onSelect: (panel) => selected.push(panel) }));
    screen.getByRole("tab", { name: "Pages" }).click();
    expect(selected).toEqual(["pages"]);
  });

  test("offers only what the project has - no icon for an empty panel", () => {
    render(switcher({ destinations: ["pages", "data"] }));
    expect(screen.queryByRole("tab", { name: "Media" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Data" })).not.toBeNull();
  });

  test("is nothing at all when there is only one destination", () => {
    render(switcher({ destinations: ["data"] }));
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("a navigation panel at tablet width", () => {
  test("carries the switcher, so Pages is one click away from Data", () => {
    render(dataPanel("tablet"));
    expect(screen.queryByRole("dialog", { name: "Data" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Pages" })).not.toBeNull();
  });

  test("carries none of it on desktop", () => {
    render(dataPanel("desktop"));
    expect(screen.queryByRole("dialog", { name: "Data" })).not.toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  /**
   * No band where there is no switcher.
   *
   * A single-destination project has nothing to switch between, so the panel
   * must be handed `undefined` rather than a switcher that renders `null`:
   * `FloatingPanel` wraps whatever it is given in a bordered row, and that row
   * around nothing is a hairline and some padding under the header.
   */
  test("leaves no empty band when there is only one destination", () => {
    // Counted rather than named: the panel has hairlines of its own (its
    // header, its filter), and the claim is that the switcher's band is not
    // among them — so the number is the one the same panel has on desktop,
    // where there is no subheader at all.
    const bands = (view: HTMLElement) =>
      view.querySelectorAll(".border-b.border-border-float").length;

    const desktop = render(dataPanel("desktop"));
    const withoutSubheader = bands(desktop.container);
    desktop.unmount();

    const single = render(dataPanel("tablet", ["data"]));
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(bands(single.container)).toBe(withoutSubheader);
    single.unmount();

    // And the band IS there when the switcher is, so the count above is
    // measuring the thing it claims to.
    const many = render(dataPanel("tablet"));
    expect(screen.queryByRole("tablist")).not.toBeNull();
    expect(bands(many.container)).toBe(withoutSubheader + 1);
  });
});
