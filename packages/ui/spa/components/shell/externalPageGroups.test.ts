import {
  countStatuses,
  filterRows,
  groupRows,
  rowUsageCount,
  toRows,
} from "./externalPageGroups";
import { checkExternalUrls } from "./externalUrlChecks";
import { ShellExternalPage, ShellExternalPageUsage } from "./types";
import { SourcePath } from "@valbuild/core";

/** A usage fixture. Branded here so the rows carry what `navigate` needs. */
const usage = (
  sourcePath: string,
  label: string,
  moduleFilePath: string,
): ShellExternalPageUsage => ({
  sourcePath: sourcePath as SourcePath,
  label,
  moduleFilePath,
});

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

function rowsOf(pages: ShellExternalPage[]) {
  return toRows(pages, checkExternalUrls(pages.map((p) => p.url)));
}

describe("rowUsageCount", () => {
  test("counts what the scan found", () => {
    expect(
      rowUsageCount(
        page("https://a.com", {
          usages: [usage("a", "a", "/a.val.ts")],
        }),
      ),
    ).toBe(1);
  });

  test("an unfinished scan has no count, even at zero", () => {
    // "Nothing found yet" and "nothing points at this" are different answers,
    // and only one of them is safe to delete on.
    expect(
      rowUsageCount(page("https://a.com", { usagesComplete: false })),
    ).toBeNull();
  });

  test("but an unfinished scan that has already found one does count it", () => {
    expect(
      rowUsageCount(
        page("https://a.com", {
          usagesComplete: false,
          usages: [usage("a", "a", "/a.val.ts")],
        }),
      ),
    ).toBe(1);
  });

  test("no scan at all has no count", () => {
    expect(
      rowUsageCount({ id: "a", name: "a", url: "https://a.com" }),
    ).toBeNull();
  });
});

describe("groupRows", () => {
  test("subdomains of one domain are one group", () => {
    const groups = groupRows(
      rowsOf([
        page("https://status.example.com"),
        page("https://portal.example.com"),
        page("https://instagram.com/val"),
      ]),
    );
    expect(groups.map((group) => group.domain)).toEqual([
      "example.com",
      "instagram.com",
    ]);
    expect(groups[0].rows).toHaveLength(2);
  });

  test("domains are alphabetical, and keys that are not URLs come last", () => {
    const groups = groupRows(
      rowsOf([
        page("zzz.example"),
        page("https://b.com"),
        page("https://a.com"),
      ]),
    );
    expect(groups.map((group) => group.domain)).toEqual([
      "a.com",
      "b.com",
      "Not a URL",
    ]);
  });

  test("rows within a group are sorted by URL", () => {
    const groups = groupRows(
      rowsOf([page("https://a.com/z"), page("https://a.com/b")]),
    );
    expect(groups[0].rows.map((row) => row.page.url)).toEqual([
      "https://a.com/b",
      "https://a.com/z",
    ]);
  });
});

describe("filterRows", () => {
  const pages = [
    page("https://instagram.com/valbuild", {
      fields: [{ label: "title", value: "Instagram" }],
      usages: [usage("s", "Footer / Social / 1", "/content/footer.val.ts")],
    }),
    page("https://unused.example.com"),
    page("http://insecure.example.com"),
  ];
  const rows = rowsOf(pages);

  test("matches the URL", () => {
    expect(
      filterRows(rows, "instagram", "all").map((row) => row.page.url),
    ).toEqual(["https://instagram.com/valbuild"]);
  });

  test("matches a field value, which is what a person remembers", () => {
    expect(filterRows(rows, "Instagram", "all")).toHaveLength(1);
  });

  test("matches where it is used", () => {
    expect(filterRows(rows, "footer", "all")).toHaveLength(1);
  });

  test("unused keeps only the ones nothing points at", () => {
    expect(filterRows(rows, "", "unused").map((row) => row.page.url)).toEqual([
      "https://unused.example.com",
      "http://insecure.example.com",
    ]);
  });

  test("issues keeps only the ones with something to look at", () => {
    expect(filterRows(rows, "", "issues").map((row) => row.page.url)).toEqual([
      "http://insecure.example.com",
    ]);
  });

  test("a row whose scan has not finished is not 'unused'", () => {
    const scanning = rowsOf([page("https://a.com", { usagesComplete: false })]);
    expect(filterRows(scanning, "", "unused")).toEqual([]);
  });
});

describe("countStatuses", () => {
  test("splits by worst severity", () => {
    const rows = rowsOf([
      page("https://fine.example.com"),
      page("http://warn.example.com"),
      page("nope"),
    ]);
    expect(countStatuses(rows)).toEqual({ ok: 1, warning: 1, error: 1 });
  });
});
