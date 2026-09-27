/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SiteUpdateSection } from "./SiteUpdateSection";
import type { SiteUpdateView } from "../../publish/useSiteUpdate";

/**
 * The update section, on its own.
 *
 * Rendering it here at all is half the point: it is presentational, and a
 * provider imported into it again would fail this file the way
 * `settingsPanelPresentational.test.tsx` describes. The other half is the two
 * promises the section makes to someone who is not a developer -- that the
 * button is only there when it can work, and that pressing it does not
 * publish their drafts -- which are sentences, and are checked as sentences.
 */

const changes = [
  {
    name: "@valbuild/cli",
    section: "devDependencies" as const,
    from: "0.136.8",
    to: "0.140.0",
  },
  {
    name: "@valbuild/core",
    section: "dependencies" as const,
    from: "0.136.8",
    to: "0.140.0",
  },
];

const renderWith = (view: SiteUpdateView, buildsInNewTab = false) => {
  const pressed: string[] = [];
  render(
    <SiteUpdateSection
      view={view}
      buildsInNewTab={buildsInNewTab}
      onUpdate={() => pressed.push("update")}
      onRetry={() => pressed.push("retry")}
      onReload={() => pressed.push("reload")}
      onOpenBuilderTab={() => pressed.push("open-tab")}
    />,
  );
  return pressed;
};

describe("the update section", () => {
  test("offers the update, naming what moves, runtime dependencies first", () => {
    const pressed = renderWith({ status: "available", changes });
    const names = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(names[0]).toContain("@valbuild/core");
    expect(names[0]).toContain("0.136.8 → 0.140.0");
    expect(names[1]).toContain("@valbuild/cli");
    expect(
      screen.queryByText(/Unpublished changes are kept, and are not published/),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Update site" }));
    expect(pressed).toEqual(["update"]);
  });

  test("in a browser that cannot build here, still offers it, in a new tab", () => {
    const pressed = renderWith({ status: "available", changes }, true);
    expect(
      screen.queryByText(/A new tab opens to build the site/),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Update site" }));
    expect(pressed).toEqual(["update"]);
  });

  test("a blocked builder tab can be opened from a click", () => {
    const pressed = renderWith({ status: "blocked" }, true);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    expect(pressed).toEqual(["open-tab"]);
  });

  test("says it is up to date, and offers nothing", () => {
    renderWith({ status: "current" });
    expect(screen.queryByText(/newest version/)).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("shows the step while it runs", () => {
    renderWith({ status: "updating", step: "Checking the site renders" });
    expect(screen.getByRole("status").textContent).toContain(
      "Checking the site renders",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("after it went live, asks for a reload", () => {
    const pressed = renderWith({ status: "updated", changes });
    fireEvent.click(screen.getByRole("button", { name: "Reload the Studio" }));
    expect(pressed).toEqual(["reload"]);
  });

  test("a failure says so, shows the details and can be retried", () => {
    const pressed = renderWith({
      status: "failed",
      message: "The update could not be published. Your site is unchanged.",
      details: "PLATFORM501: render failed",
    });
    expect(screen.queryByText(/Your site is unchanged/)).not.toBeNull();
    expect(screen.queryByText("PLATFORM501: render failed")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(pressed).toEqual(["retry"]);
  });

  test("a refusal is the platform's own sentence", () => {
    renderWith({
      status: "unavailable",
      message: "This project depends on left-pad, which its template does not.",
    });
    expect(screen.queryByText(/left-pad/)).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
