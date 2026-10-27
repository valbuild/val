import { collectSearchResults } from "./GlobalSearch";
import { mockShellData } from "./mockShellData";
import { ShellData } from "./types";

describe("collectSearchResults", () => {
  test("does not offer a folder row, which is a route pattern and not a page", () => {
    // `/blog` is in the site map only because `/blog/why-we-built-val` is. It
    // has no source path, and the only URL it has is the PATTERN its children
    // share (`/blog/[slug]`) - so a row for it sends you to a page that does
    // not exist.
    const rows = collectSearchResults(mockShellData);
    const pages = rows.filter((row) => row.kind === "page");
    expect(pages.some((row) => row.detail.includes("["))).toBe(false);
    expect(pages.some((row) => row.label === "blog")).toBe(false);
  });

  test("still offers the pages under a folder row", () => {
    const rows = collectSearchResults(mockShellData);
    expect(
      rows.some(
        (row) => row.kind === "page" && row.detail === "/blog/why-we-built-val",
      ),
    ).toBe(true);
  });

  test("offers a page that has a source path", () => {
    const rows = collectSearchResults(mockShellData);
    const pricing = rows.find((row) => row.detail === "/pricing");
    expect(pricing?.kind).toBe("page");
  });

  test("keeps the other kinds of row", () => {
    const rows = collectSearchResults(mockShellData);
    for (const kind of ["data", "media", "external"] as const) {
      expect(rows.some((row) => row.kind === kind)).toBe(true);
    }
  });

  test("walks children of a folder row that is itself a page", () => {
    // A segment can be both: `/docs` has its own module AND pages below it.
    // The row is offered, and the children are still walked.
    const data: ShellData = {
      ...mockShellData,
      pages: [
        {
          id: '/app/docs/page.val.ts?p="/docs"',
          name: "docs",
          urlPath: "/docs",
          sourcePath: '/app/docs/page.val.ts?p="/docs"',
          isTracked: true,
          children: [
            {
              id: '/app/docs/[page]/page.val.ts?p="/docs/cli"',
              name: "cli",
              urlPath: "/docs/cli",
              sourcePath: '/app/docs/[page]/page.val.ts?p="/docs/cli"',
              isTracked: true,
            },
          ],
        },
      ],
    };
    const details = collectSearchResults(data)
      .filter((row) => row.kind === "page")
      .map((row) => row.detail);
    expect(details).toEqual(["/docs", "/docs/cli"]);
  });
});
