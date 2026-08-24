import { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  hostLabel,
  initialsOf,
  toActivity,
  toDataModules,
  toExternalPages,
  toShellPages,
  toValidationErrors,
} from "./shellDataMapping";
import { ExplorerItem, SitemapItem } from "../NavMenu/types";

/**
 * The provider-to-shell mapping.
 *
 * `useShellData` itself needs the whole provider tree to run, so what is
 * pinned here is the translation: the shapes the nav menu, the patch sets and
 * the validation errors actually produce, turned into what the shell renders.
 */

const path = (p: string) => p as ModuleFilePath;

describe("toShellPages", () => {
  // The site map's root stands for the site, not for a page.
  const sitemap: SitemapItem = {
    name: "root",
    urlPath: "/",
    children: [
      {
        name: "about",
        urlPath: "/about",
        moduleFilePath: path("/content/pages.val.ts"),
        children: [],
      },
      {
        name: "blog",
        urlPath: "/blog",
        children: [
          {
            name: "first-post",
            urlPath: "/blog/first-post",
            errors: { ownCount: 2 },
            children: [],
          },
        ],
      },
    ],
  };

  test("drops the root and keeps its children as the top level", () => {
    const pages = toShellPages(sitemap, new Set());
    expect(pages.map((p) => p.urlPath)).toEqual(["/about", "/blog"]);
  });

  test("keeps the tree, and carries errors from the row they belong to", () => {
    const [, blog] = toShellPages(sitemap, new Set());
    expect(blog.children?.[0]).toMatchObject({
      urlPath: "/blog/first-post",
      errorCount: 2,
    });
    // Errors sit on the child, not smeared onto the parent — the panel
    // aggregates them at render time when a folder is collapsed.
    expect(blog.errorCount).toBeUndefined();
  });

  test("marks a page whose module has unpublished patches", () => {
    const [about] = toShellPages(sitemap, new Set(["/content/pages.val.ts"]));
    expect(about.hasDraft).toBe(true);
  });

  test("uses the url path as the id, so rows are addressable", () => {
    const [about] = toShellPages(sitemap, new Set());
    expect(about.id).toBe("/about");
  });
});

describe("toExternalPages", () => {
  test("turns the record's keys into rows labelled by host and path", () => {
    const record: Record<string, SourcePath> = {
      "https://instagram.com/valbuild": "x" as SourcePath,
      "https://example.com/": "y" as SourcePath,
    };
    expect(toExternalPages(record)).toEqual([
      {
        id: "https://instagram.com/valbuild",
        name: "instagram.com/valbuild",
        url: "https://instagram.com/valbuild",
      },
      {
        id: "https://example.com/",
        name: "example.com",
        url: "https://example.com/",
      },
    ]);
  });

  test("is empty while the record is still loading", () => {
    expect(toExternalPages(undefined)).toEqual([]);
    expect(toExternalPages(null)).toEqual([]);
  });
});

describe("hostLabel", () => {
  test("falls back to the raw key when it is not a URL", () => {
    // Record keys are not guaranteed to parse; showing the key beats showing
    // nothing at all.
    expect(hostLabel("not a url")).toBe("not a url");
  });
});

describe("toDataModules", () => {
  const explorer: ExplorerItem = {
    name: "content",
    fullPath: "/content",
    isDirectory: true,
    children: [
      {
        name: "settings",
        fullPath: "/content/settings.val.ts",
        isDirectory: false,
        children: [],
      },
      {
        name: "nested",
        fullPath: "/content/nested",
        isDirectory: true,
        children: [
          {
            name: "products",
            fullPath: "/content/nested/products.val.ts",
            isDirectory: false,
            errors: { ownCount: 3 },
            children: [],
          },
        ],
      },
    ],
  };

  test("flattens to files, dropping the directories themselves", () => {
    const modules = toDataModules(explorer, new Set());
    expect(modules.map((m) => m.moduleFilePath)).toEqual([
      "/content/settings.val.ts",
      "/content/nested/products.val.ts",
    ]);
  });

  test("carries errors and draft state per file", () => {
    const modules = toDataModules(
      explorer,
      new Set(["/content/settings.val.ts"]),
    );
    expect(modules[0].hasDraft).toBe(true);
    expect(modules[1].errorCount).toBe(3);
    expect(modules[1].hasDraft).toBe(false);
  });
});

describe("toValidationErrors", () => {
  test("groups by module and counts, worst first", () => {
    const errors = {
      ['/content/products.val.ts?p="a"' as SourcePath]: [{}],
      ['/content/products.val.ts?p="b"' as SourcePath]: [{}],
      ['/content/settings.val.ts?p="c"' as SourcePath]: [{}],
    };
    expect(toValidationErrors(errors)).toEqual([
      {
        id: "/content/products.val.ts",
        title: "products",
        detail: "/content/products.val.ts",
        count: 2,
      },
      {
        id: "/content/settings.val.ts",
        title: "settings",
        detail: "/content/settings.val.ts",
        count: 1,
      },
    ]);
  });

  test("is empty before the errors have loaded", () => {
    expect(toValidationErrors(undefined)).toEqual([]);
  });
});

describe("toActivity", () => {
  const set = (moduleFilePath: string, patchPath: string[], at: string) => ({
    moduleFilePath: path(moduleFilePath),
    patchPath,
    lastUpdated: at,
    lastUpdatedBy: "ada",
  });

  test("reads as a trail from the file to what changed in it", () => {
    const [entry] = toActivity([
      set("/content/home.val.ts", ["hero", "title"], "2026-08-24T10:00:00Z"),
    ]);
    expect(entry.title).toBe("home › hero › title");
    expect(entry.author).toBe("ada");
    expect(entry.timestamp).toBe("2026-08-24T10:00:00Z");
  });

  test("keeps the newest few, in the order the patch sets give them", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      set("/content/home.val.ts", [`field${i}`], "2026-08-24T10:00:00Z"),
    );
    const activity = toActivity(many);
    expect(activity).toHaveLength(8);
    expect(activity[0].title).toBe("home › field0");
  });

  test("gives every entry a distinct key even for repeated paths", () => {
    // Two patch sets can share a module and path; React needs them apart.
    const activity = toActivity([
      set("/content/home.val.ts", ["title"], "2026-08-24T10:00:00Z"),
      set("/content/home.val.ts", ["title"], "2026-08-23T10:00:00Z"),
    ]);
    expect(activity[0].id).not.toBe(activity[1].id);
  });

  test("survives a patch with no author", () => {
    const [entry] = toActivity([
      { ...set("/content/home.val.ts", ["title"], "x"), lastUpdatedBy: null },
    ]);
    expect(entry.author).toBeUndefined();
  });
});

describe("initialsOf", () => {
  test.each([
    ["Fredrik Ekholdt", "FE"],
    ["Ada", "AD"],
    ["Ada Byron King Lovelace", "AL"],
    ["  spaced   out  ", "SO"],
  ])("%s -> %s", (name, expected) => {
    expect(initialsOf(name)).toBe(expected);
  });

  test("does not crash on an empty name", () => {
    expect(initialsOf("")).toBe("?");
  });
});
