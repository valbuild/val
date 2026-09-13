/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ExternalPagesDialog } from "./ExternalPagesDialog";
import { ShellExternalPage } from "./types";

/**
 * What a URL row in the external pages dialog is called.
 *
 * The same mistake `panelRow.test.tsx` records, found the same way: the usage
 * badge and the error count sat inside the row's own button, so a row
 * announced itself as "/valbuild/reels unused" and a `getByRole("button",
 * { name })` matching it stopped matching the moment something linked to that
 * URL. The name is the URL; everything else is a description.
 */
function renderDialog(pages: ShellExternalPage[]) {
  render(
    <ExternalPagesDialog
      open
      onOpenChange={() => undefined}
      breakpoint="desktop"
      pages={pages}
      onOpenEntry={() => undefined}
    />,
  );
}

function page(
  url: string,
  extra: Partial<ShellExternalPage> = {},
): ShellExternalPage {
  return {
    id: url,
    name: url,
    url,
    usages: [],
    usagesComplete: true,
    ...extra,
  };
}

describe("an external page row", () => {
  test("is named by its URL alone", () => {
    renderDialog([page("https://example.com/a")]);
    expect(screen.getByRole("button", { name: "/a" })).not.toBeNull();
  });

  test("keeps that name when nothing links to it", () => {
    renderDialog([page("https://example.com/a")]);
    // `usages: []` already means unused - the badge is drawn, the name is not
    // allowed to change.
    expect(screen.getByRole("button", { name: "/a" })).not.toBeNull();
  });

  test("keeps that name when things do link to it", () => {
    renderDialog([
      page("https://example.com/a", {
        usages: [
          { sourcePath: "s", label: "Footer", moduleFilePath: "/f.val.ts" },
        ],
      }),
    ]);
    expect(screen.getByRole("button", { name: "/a" })).not.toBeNull();
  });

  test("keeps that name when it has validation errors and check issues", () => {
    renderDialog([page("http://example.com/a", { errorCount: 2 })]);
    expect(
      screen.getByRole("button", { name: "http://example.com/a" }),
    ).not.toBeNull();
  });

  test("says what its badges mean, as a description", () => {
    renderDialog([page("http://example.com/a", { errorCount: 1 })]);
    const row = screen.getByRole("button", { name: "http://example.com/a" });
    const description = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toBe(
      "Nothing links to this, 1 validation error, Uses http://. Browsers warn on it, and most sites answer on https://.",
    );
  });

  test("says so rather than saying 'unused' while the scan is unfinished", () => {
    renderDialog([page("https://example.com/a", { usagesComplete: false })]);
    const row = screen.getByRole("button", { name: "/a" });
    const description = document.getElementById(
      row.getAttribute("aria-describedby") ?? "",
    );
    expect(description?.textContent).toBe("Still counting where this is used");
  });
});
