import { ModuleFilePath, SourcePath } from "@valbuild/core";
import {
  availableDestinations,
  hostLabel,
  initialsOf,
  toActivity,
  toAdminLinks,
  toDataModules,
  toExternalPages,
  toShellPages,
  toValidationErrors,
} from "./shellDataMapping";
import { ExplorerItem, SitemapItem } from "../NavMenu/types";
import { ShellData, ShellDataModule, ShellMediaGallery } from "./types";

/**
 * The provider-to-shell mapping.
 *
 * `useShellData` itself needs the whole provider tree to run, so what is
 * pinned here is the translation: the shapes the nav menu, the patch sets and
 * the validation errors actually produce, turned into what the shell renders.
 */

const path = (p: string) => p as ModuleFilePath;
const source = (p: string) => p as SourcePath;

describe("toShellPages", () => {
  // The site map's root stands for the site, not for a page.
  const sitemap: SitemapItem = {
    name: "root",
    urlPath: "/",
    children: [
      {
        name: "about",
        urlPath: "/about",
        sourcePath: source('/app/about/page.val.ts?p="/about"'),
        moduleFilePath: path("/app/about/page.val.ts"),
        children: [],
      },
      {
        // A folder row: it exists because pages exist below it, so the sitemap
        // gives it no source path of its own.
        name: "blog",
        urlPath: "/blog/[slug]",
        children: [
          {
            name: "first-post",
            urlPath: "/blog/first-post",
            sourcePath: source(
              '/app/blog/[slug]/page.val.ts?p="/blog/first-post"',
            ),
            errors: { ownCount: 2 },
            children: [],
          },
          {
            name: "second-post",
            urlPath: "/blog/second-post",
            sourcePath: source(
              '/app/blog/[slug]/page.val.ts?p="/blog/second-post"',
            ),
            children: [],
          },
        ],
      },
    ],
  };

  test("drops a purely structural root and lifts its children", () => {
    const pages = toShellPages(sitemap, new Set());
    expect(pages.map((p) => p.urlPath)).toEqual(["/about", "/blog/[slug]"]);
  });

  test("keeps a root that is itself a page, with the rest under it", () => {
    // An `/app/page.val.ts` puts content on `/`, so the root is both the site
    // and the home page. Dropping it would leave the home page as the one page
    // the navigation cannot reach.
    const withHome: SitemapItem = {
      ...sitemap,
      sourcePath: source('/app/page.val.ts?p="/"'),
      moduleFilePath: path("/app/page.val.ts"),
    };
    const pages = toShellPages(withHome, new Set());
    expect(pages).toHaveLength(1);
    expect(pages[0].id).toBe('/app/page.val.ts?p="/"');
    expect(pages[0].children?.map((child) => child.urlPath)).toEqual([
      "/about",
      "/blog/[slug]",
    ]);
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
    const [about] = toShellPages(sitemap, new Set(["/app/about/page.val.ts"]));
    expect(about.hasDraft).toBe(true);
  });

  test("identifies a page by the content it opens", () => {
    // The id doubles as the navigation target, so the app can resolve the
    // route it is on back to a row without keeping a second mapping.
    const [about] = toShellPages(sitemap, new Set());
    expect(about.id).toBe('/app/about/page.val.ts?p="/about"');
    expect(about.sourcePath).toBe(about.id);
  });

  test("gives siblings under one dynamic route distinct ids", () => {
    // Every post under `/blog/[slug]` is served by the same route module and
    // shares the same route *pattern*. Identifying rows by anything the
    // pattern contributes would collapse them all onto one row.
    const [, blog] = toShellPages(sitemap, new Set());
    const ids = (blog.children ?? []).map((child) => child.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("leaves a folder row unopenable, and marks it untracked", () => {
    // A path segment that is not itself a page has no content and no route
    // for the canvas to ask about.
    const [, blog] = toShellPages(sitemap, new Set());
    expect(blog.sourcePath).toBeUndefined();
    expect(blog.isTracked).toBe(false);
    expect(blog.children?.[0]?.isTracked).toBe(true);
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
        // As with pages, the id is the content the row opens.
        id: "x",
        name: "instagram.com/valbuild",
        url: "https://instagram.com/valbuild",
        sourcePath: "x",
      },
      {
        id: "y",
        name: "example.com",
        url: "https://example.com/",
        sourcePath: "y",
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
  /** Ten minutes after the timestamps below, so "10 minutes ago" is stable. */
  const now = new Date("2026-08-24T10:10:00Z").getTime();

  test("reads as a trail from the file to what changed in it", () => {
    const [entry] = toActivity(
      [set("/content/home.val.ts", ["hero", "title"], "2026-08-24T10:00:00Z")],
      now,
    );
    expect(entry.title).toBe("home › hero › title");
    expect(entry.author).toBe("ada");
    // Relative, not the raw ISO string, which is what the panel used to render.
    expect(entry.timestamp).toBe("10 minutes ago");
  });

  test("carries a source path that resolves", () => {
    // The grammar matters: string keys are quoted, array indices are bare. A
    // hand-joined path looks close enough to work and then opens nothing.
    const [entry] = toActivity(
      [set("/content/home.val.ts", ["items", "0", "title"], "x")],
      now,
    );
    expect(entry.sourcePath).toBe('/content/home.val.ts?p="items".0."title"');
  });

  test("a whole-module change points at the module", () => {
    const [entry] = toActivity([set("/content/home.val.ts", [], "x")], now);
    expect(entry.sourcePath).toBe("/content/home.val.ts");
  });

  test("keeps the newest few, in the order the patch sets give them", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      set("/content/home.val.ts", [`field${i}`], "2026-08-24T10:00:00Z"),
    );
    const activity = toActivity(many, now);
    expect(activity).toHaveLength(8);
    expect(activity[0].title).toBe("home › field0");
  });

  test("gives every entry a distinct key even for repeated paths", () => {
    // Two patch sets can share a module and path; React needs them apart.
    const activity = toActivity(
      [
        set("/content/home.val.ts", ["title"], "2026-08-24T10:00:00Z"),
        set("/content/home.val.ts", ["title"], "2026-08-23T10:00:00Z"),
      ],
      now,
    );
    expect(activity[0].id).not.toBe(activity[1].id);
  });

  test("survives a patch with no author", () => {
    const [entry] = toActivity(
      [{ ...set("/content/home.val.ts", ["title"], "x"), lastUpdatedBy: null }],
      now,
    );
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

/**
 * Which destinations a project offers.
 *
 * The rule is per-destination and each has a different source, which is the
 * part worth pinning: Pages follows the routers existing rather than the site
 * map having entries, while Media and Data follow their lists — because an
 * empty gallery is still a gallery, but there is no such thing as a data module
 * that is present and empty.
 */
describe("availableDestinations", () => {
  const project = (
    over: Partial<Pick<ShellData, "hasRouters" | "media" | "data">>,
  ): Pick<ShellData, "hasRouters" | "media" | "data"> => ({
    hasRouters: false,
    media: [],
    data: [],
    ...over,
  });
  const gallery: ShellMediaGallery = {
    id: "/content/media.val.ts",
    name: "images",
    directory: "/public/val/images",
    moduleFilePath: "/content/media.val.ts",
    itemCount: 0,
    mediaType: "images",
  };
  const dataModule: ShellDataModule = {
    id: "/content/settings.val.ts",
    name: "settings",
    moduleFilePath: "/content/settings.val.ts",
  };

  test("a project using all of Val offers all three", () => {
    expect(
      availableDestinations(
        project({ hasRouters: true, media: [gallery], data: [dataModule] }),
        false,
      ),
    ).toEqual(["pages", "media", "data"]);
  });

  test("no router means no Pages", () => {
    expect(
      availableDestinations(project({ data: [dataModule] }), false),
    ).toEqual(["data"]);
  });

  test("a router with no pages in it yet still offers Pages", () => {
    // The site map is the thing you add the first page from, so hiding it
    // would leave a new project with no way to make one.
    expect(availableDestinations(project({ hasRouters: true }), false)).toEqual(
      ["pages"],
    );
  });

  test("no gallery module means no Media", () => {
    expect(
      availableDestinations(project({ hasRouters: true }), false),
    ).not.toContain("media");
  });

  test("an empty gallery is still a gallery", () => {
    // `itemCount: 0` is a gallery with nothing uploaded into it — which is
    // exactly where "Upload media" is most useful.
    expect(availableDestinations(project({ media: [gallery] }), false)).toEqual(
      ["media"],
    );
  });

  test("only routers and galleries means no Data", () => {
    expect(
      availableDestinations(
        project({ hasRouters: true, media: [gallery] }),
        false,
      ),
    ).toEqual(["pages", "media"]);
  });

  test("a project using none of it offers nothing", () => {
    expect(availableDestinations(project({}), false)).toEqual([]);
  });

  test("everything is on offer while the navigation loads", () => {
    // The panels have loading states; a rail that grows icons as the data
    // arrives is worse than one that starts full and settles.
    expect(availableDestinations(project({}), true)).toEqual([
      "pages",
      "media",
      "data",
    ]);
  });
});

describe("toAdminLinks", () => {
  const appHost = "https://admin.val.build";

  test("splits config.project into the org's and the project's pages", () => {
    expect(toAdminLinks({ project: "acme/marketing-site", appHost })).toEqual({
      project: "https://admin.val.build/~/acme/marketing-site",
      members: "https://admin.val.build/manage-members/acme",
    });
  });

  test("a project that is not connected has nowhere to go", () => {
    expect(toAdminLinks({ appHost })).toBeUndefined();
    expect(toAdminLinks(undefined)).toBeUndefined();
  });

  test("a project that is not <org>/<project> has nowhere to go", () => {
    // Rather than a link to a 404: `val connect` rejects these too.
    expect(
      toAdminLinks({ project: "marketing-site", appHost }),
    ).toBeUndefined();
    expect(
      toAdminLinks({ project: "acme/marketing/site", appHost }),
    ).toBeUndefined();
    expect(toAdminLinks({ project: "acme/", appHost })).toBeUndefined();
    expect(
      toAdminLinks({ project: "/marketing-site", appHost }),
    ).toBeUndefined();
  });

  test("a trailing slash on the host does not double up", () => {
    expect(
      toAdminLinks({ project: "acme/marketing-site", appHost: appHost + "/" }),
    ).toEqual({
      project: "https://admin.val.build/~/acme/marketing-site",
      members: "https://admin.val.build/manage-members/acme",
    });
  });
});
