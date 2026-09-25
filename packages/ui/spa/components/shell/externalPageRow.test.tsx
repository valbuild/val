/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ExternalPagesDialog } from "./ExternalPagesDialog";
import { ShellExternalPage } from "./types";
import { SourcePath } from "@valbuild/core";

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
          {
            sourcePath: "s" as SourcePath,
            label: "Footer",
            moduleFilePath: "/f.val.ts",
          },
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
    // One mention of the validation error, not two: `toRows` folds it into the
    // row's issues, so the description reads it from there like any other
    // finding rather than also counting it separately.
    expect(description?.textContent).toBe(
      "Nothing links to this, Has 1 validation error., Uses http://. Browsers warn on it, and most sites answer on https://.",
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

/**
 * A key the router refuses is never clickable from the Studio.
 *
 * Validation reports a `javascript:` key; it does not delete it, and the
 * dialog's whole job is to show keys that are wrong. Rendering one in an
 * `href` would make the Studio the place where it runs.
 */
describe("the detail pane's open-in-a-new-tab link", () => {
  function openDetail(url: string) {
    renderDialog([page(url)]);
    // By title rather than by name: a row is LABELLED with what the group
    // heading above it does not already say, and its title is the whole key.
    fireEvent.click(screen.getByTitle(url));
  }

  test("is there for a key the router accepts", () => {
    openDetail("https://example.com/a");
    expect(
      screen.getByRole("link", {
        name: "Open https://example.com/a in a new tab",
      }),
    ).not.toBeNull();
  });

  test("is there for a mailto:, which is an ordinary external page", () => {
    openDetail("mailto:post@example.com");
    expect(
      screen.getByRole("link", {
        name: "Open mailto:post@example.com in a new tab",
      }),
    ).not.toBeNull();
  });

  test("is absent for a scheme that runs code", () => {
    const url = "javascript:alert(1)";
    openDetail(url);
    expect(screen.queryAllByRole("link")).toEqual([]);
    // The URL is still shown and still copyable: reading a bad key is why you
    // opened the row.
    expect(screen.getAllByText(url).length).toBeGreaterThan(0);
  });
});

/**
 * Where a validation error is printed, given what else is on the pane.
 *
 * With the real field editors in the pane, each error is already shown
 * against the field it is about - a better place for it than a list at the
 * top, and printing it in both is the same sentence twice. Without them, the
 * list is the only thing that would say it.
 */
describe("an entry that does not validate", () => {
  const invalid = { errorCount: 1, errorMessages: ["Title is required"] };

  test("is listed at the top when the fields are shown as text", () => {
    renderDialog([page("https://example.com/a", invalid)]);
    fireEvent.click(screen.getByTitle("https://example.com/a"));
    expect(screen.getAllByText("Title is required").length).toBe(1);
  });

  test("is left to the fields when the fields are editable", () => {
    render(
      <ExternalPagesDialog
        open
        onOpenChange={() => undefined}
        breakpoint="desktop"
        pages={[page("https://example.com/a", invalid)]}
        onOpenEntry={() => undefined}
        renderEntry={() => <div>the editors</div>}
      />,
    );
    fireEvent.click(screen.getByTitle("https://example.com/a"));
    expect(screen.queryByText("Title is required")).toBeNull();
    expect(screen.getByText("the editors")).not.toBeNull();
  });

  test("a URL finding is still listed, editors or not", () => {
    // Nothing else on the pane would say it: the fields are about the entry,
    // and this is about the key.
    render(
      <ExternalPagesDialog
        open
        onOpenChange={() => undefined}
        breakpoint="desktop"
        pages={[page("http://example.com/a", invalid)]}
        onOpenEntry={() => undefined}
        renderEntry={() => <div>the editors</div>}
      />,
    );
    fireEvent.click(screen.getByTitle("http://example.com/a"));
    // More than one: the pane's list, and the row's own hidden description.
    expect(screen.getAllByText(/Uses http:\/\//).length).toBeGreaterThan(0);
  });
});
