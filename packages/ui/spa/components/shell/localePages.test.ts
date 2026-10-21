import { pagesInLocale } from "./localePages";
import { ShellPage } from "./types";

const NEWS = "/src/routes/_site.{-$locale}.news.$slug.val.ts";
const page = (
  urlPath: string,
  locale?: string,
  children: ShellPage[] = [],
): ShellPage => ({
  id: `${NEWS}?p=${JSON.stringify(urlPath)}`,
  name: urlPath.split("/").pop() || "/",
  urlPath,
  sourcePath: `${NEWS}?p=${JSON.stringify(urlPath)}`,
  isTracked: true,
  ...(locale ? { locale } : {}),
  children,
});
const folder = (urlPath: string, children: ShellPage[]): ShellPage => ({
  id: urlPath,
  name: urlPath.split("/").pop() || "/",
  urlPath,
  isTracked: false,
  children,
});

const site = [
  page("/", undefined, [
    page("/about"),
    folder("/news", [page("/news/val-in-english", "en-US")]),
    folder("/nb", [
      folder("/nb/news", [page("/nb/news/val-pa-norsk", "nb-NO")]),
    ]),
  ]),
];

const urls = (pages: ShellPage[]): string[] =>
  pages.flatMap((p) => [p.urlPath, ...urls(p.children ?? [])]);

describe("pagesInLocale", () => {
  test("no language picked lists everything, unchanged", () => {
    expect(pagesInLocale(site, null, null)).toBe(site);
  });

  test("a page in another language goes, and so does the folder it leaves empty", () => {
    expect(urls(pagesInLocale(site, "nb-NO", null))).toEqual([
      "/",
      "/about",
      "/nb",
      "/nb/news",
      "/nb/news/val-pa-norsk",
    ]);
    expect(urls(pagesInLocale(site, "en-US", null))).toEqual([
      "/",
      "/about",
      "/news",
      "/news/val-in-english",
    ]);
  });

  test("the page the editor is on stays listed, and only that one", () => {
    const at = `${NEWS}?p=${JSON.stringify("/news/val-in-english")}."title"`;
    expect(urls(pagesInLocale(site, "nb-NO", at))).toEqual([
      "/",
      "/about",
      "/news",
      "/news/val-in-english",
      "/nb",
      "/nb/news",
      "/nb/news/val-pa-norsk",
    ]);
  });

  test("a hidden page with listed pages under it becomes a folder", () => {
    const localized = [
      page("/", "en-US", [page("/about"), page("/nb", "nb-NO")]),
    ];
    const [root] = pagesInLocale(localized, "nb-NO", null);
    expect(root.sourcePath).toBeUndefined();
    expect(root.isTracked).toBe(false);
    expect(urls(root.children ?? [])).toEqual(["/about", "/nb"]);
  });
});
