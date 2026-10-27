import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { countPages } from "./PagesPanel";
import { toShellPages } from "./shellDataMapping";
import type { ShellPage } from "./types";
import type { SitemapItem } from "../NavMenu/types";

// Branded-path helpers, as in `shellDataMapping.test.ts`.
const path = (p: string) => p as ModuleFilePath;
const source = (p: string) => p as SourcePath;

/**
 * The count beside "Pages" in the left nav.
 *
 * It used to be `filtered.length`, and the thing being counted is a TREE. On
 * any project with a home page at `/`, `toShellPages` returns a single root row
 * with the whole site nested underneath — so the panel said "Pages 1" forever,
 * which is what this exists to stop happening again.
 */

const page = (
  id: string,
  children: ShellPage[] = [],
  isTracked = true,
): ShellPage => ({
  id,
  name: id,
  urlPath: id,
  isTracked,
  children,
});

describe("countPages", () => {
  test("counts every page in the tree, not the top-level rows", () => {
    const tree = [
      page("/", [
        page("/pricing"),
        page("/blog", [page("/blog/one"), page("/blog/two")]),
      ]),
    ];
    expect(tree).toHaveLength(1);
    expect(countPages(tree)).toBe(5);
  });

  test("does not count folder rows", () => {
    // `/blog` exists only because `/blog/one` does: it has no content of its
    // own, so it is a row you expand rather than a page you open.
    const tree = [page("/", [page("/blog", [page("/blog/one")], false)])];
    expect(countPages(tree)).toBe(2);
  });

  test("is 0 for an empty tree", () => {
    expect(countPages([])).toBe(0);
  });

  test("the shape that made it read 1 — through the real mapping", () => {
    const sitemap: SitemapItem = {
      name: "root",
      urlPath: "/",
      // A root that is ITSELF a page: `/app/page.val.ts` puts content on `/`,
      // so the whole site nests under one row. This is the common case, and
      // the one the old count got wrong.
      sourcePath: source('/app/page.val.ts?p="/"'),
      moduleFilePath: path("/app/page.val.ts"),
      children: [
        {
          name: "pricing",
          urlPath: "/pricing",
          sourcePath: source('/app/pricing/page.val.ts?p="/pricing"'),
          moduleFilePath: path("/app/pricing/page.val.ts"),
          children: [],
        },
        {
          name: "about",
          urlPath: "/about",
          sourcePath: source('/app/about/page.val.ts?p="/about"'),
          moduleFilePath: path("/app/about/page.val.ts"),
          children: [],
        },
      ],
    };

    const pages = toShellPages(sitemap, new Set());
    // One root row, three pages: the disagreement that was the bug.
    expect(pages).toHaveLength(1);
    expect(countPages(pages)).toBe(3);
  });
});
