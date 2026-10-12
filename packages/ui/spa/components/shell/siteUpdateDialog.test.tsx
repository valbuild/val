/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { SiteUpdateDialog } from "./SiteUpdateDialog";
import type { SiteUpdateView } from "../../publish/useSiteUpdate";

/**
 * The update dialog, on its own. What it promises an editor -- what moves,
 * that their drafts are not published, that a failure changes nothing -- are
 * sentences, and are checked as sentences.
 */

const changes = [
  {
    name: "@valbuild/core",
    section: "dependencies" as const,
    from: "0.142.0",
    to: "0.145.0",
  },
  {
    name: "zod",
    section: "dependencies" as const,
    from: "3.24.1",
    to: "4.1.0",
  },
  {
    name: "typescript",
    section: "devDependencies" as const,
    from: "5.8.3",
    to: "5.9.2",
  },
];

const renderWith = (
  view: SiteUpdateView,
  options: { pendingChanges?: number; buildsInNewTab?: boolean } = {},
) => {
  const pressed: string[] = [];
  render(
    <SiteUpdateDialog
      view={view}
      breakpoint="desktop"
      buildsInNewTab={options.buildsInNewTab ?? false}
      pendingChanges={options.pendingChanges ?? 0}
      onUpdate={() => pressed.push("update")}
      onRetry={() => pressed.push("retry")}
      onReload={() => pressed.push("reload")}
      onOpenBuilderTab={() => pressed.push("open-tab")}
      onClose={() => pressed.push("close")}
    />,
  );
  return pressed;
};

describe("the update dialog", () => {
  test("offers the update with Val as the headline and the rest folded", () => {
    const pressed = renderWith({ status: "available", changes });
    expect(screen.getByText("0.142.0 → 0.145.0")).not.toBeNull();
    expect(screen.getByText("2 other packages")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: /What's new/ }).getAttribute("href"),
    ).toContain("%40valbuild%2Fcore%400.145.0");
    fireEvent.click(screen.getByRole("button", { name: "Update site" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(pressed).toEqual(["update", "close"]);
  });

  test("says the editor's unpublished changes are kept and not published", () => {
    renderWith({ status: "available", changes }, { pendingChanges: 3 });
    expect(
      screen.getByText(
        /You have 3 unpublished changes\. They are kept, and are not published/,
      ),
    ).not.toBeNull();
  });

  test("says when the update builds in a tab of its own", () => {
    renderWith({ status: "available", changes }, { buildsInNewTab: true });
    expect(
      screen.getByText(/A new tab opens to build the site/),
    ).not.toBeNull();
  });

  test("shows which of the three steps it is on, and that editing goes on", () => {
    renderWith({
      status: "updating",
      step: "Checking the site renders",
      percent: 70,
      stage: "checking",
    });
    expect(screen.getByRole("status").textContent).toBe(
      "Checking the site renders · 70%",
    );
    expect(screen.getByText(/You can keep editing/)).not.toBeNull();
  });

  test("a failure says nothing changed, and offers the details and a retry", () => {
    const pressed = renderWith({
      status: "failed",
      message: "The updated site did not pass its check.",
      details: "GET / → 500",
    });
    expect(screen.getByText(/Your site has not changed/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("GET / → 500")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(pressed).toEqual(["retry"]);
  });

  test("once live, asks for the reload that brings the new Studio", () => {
    const pressed = renderWith({ status: "updated", changes });
    expect(
      screen.getByText(/Live on Val 0\.145\.0, with 2 other packages/),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload Studio" }));
    expect(pressed).toEqual(["reload"]);
  });

  test("a blocked builder tab is opened again from a click", () => {
    const pressed = renderWith({ status: "blocked" });
    fireEvent.click(screen.getByRole("button", { name: "Open the build tab" }));
    expect(pressed).toEqual(["open-tab"]);
  });
});
