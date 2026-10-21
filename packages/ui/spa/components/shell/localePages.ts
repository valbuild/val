import { isAtLocation } from "../../utils/isAtLocation";
import { ShellPage } from "./types";

/**
 * The page tree, as the language the Studio is showing leaves it.
 *
 * A page in another language is not listed, and neither is a folder that held
 * nothing else. A page in NO language is always listed — it is what every
 * language shares. And the page the editor is ON is listed whatever language
 * it is in: the only way there is to have been sent (a link, a reference), and
 * a tree that hides where you are cannot say where you are. Only that page —
 * see `isAtLocation`.
 *
 * A page that is hidden but holds pages that are not — `/` in English, with
 * `/nb/…` under it — stays as a folder: the rows under it still need their
 * place in the URL tree, and the page itself is no longer something to open.
 *
 * Returns the same array when nothing is filtered, so a memo downstream does
 * not see a change that is not one.
 */
export function pagesInLocale(
  pages: ShellPage[],
  locale: string | null,
  location: string | null,
): ShellPage[] {
  if (locale === null) {
    return pages;
  }
  const visible = (page: ShellPage) =>
    page.locale === undefined ||
    page.locale === locale ||
    isAtLocation(location, page.sourcePath);
  const filter = (rows: ShellPage[]): ShellPage[] =>
    rows.flatMap((page): ShellPage[] => {
      const children =
        page.children === undefined ? undefined : filter(page.children);
      if (page.sourcePath !== undefined && visible(page)) {
        return [{ ...page, children }];
      }
      if (children === undefined || children.length === 0) {
        return [];
      }
      return [
        {
          id: page.urlPath,
          name: page.name,
          urlPath: page.urlPath,
          isTracked: false,
          children,
        },
      ];
    });
  return filter(pages);
}

/**
 * Where an editor lands when the language they picked has nothing where they
 * were: that language's start.
 *
 * The site's own root when it is listed — `/` is the page every site has and
 * the one an editor recognises, and it is listed when it is in this language
 * or in none. Otherwise the shortest route in this language (`/nb`), which is
 * that language's home page on a site whose URLs name their language. Otherwise
 * the first page listed at all, and `null` when nothing is.
 *
 * Takes the tree `pagesInLocale` returned, so every candidate is one the editor
 * can see.
 */
export function localeRootPage(
  pages: ShellPage[],
  locale: string,
): ShellPage | null {
  const tracked: ShellPage[] = [];
  const walk = (rows: ShellPage[]) => {
    for (const page of rows) {
      if (page.sourcePath !== undefined) {
        tracked.push(page);
      }
      walk(page.children ?? []);
    }
  };
  walk(pages);
  const root = tracked.find(
    (page) =>
      page.urlPath === "/" &&
      (page.locale === undefined || page.locale === locale),
  );
  if (root !== undefined) {
    return root;
  }
  const depth = (page: ShellPage) =>
    page.urlPath.split("/").filter((part) => part !== "").length;
  const byUrl = (a: ShellPage, b: ShellPage) =>
    depth(a) - depth(b) || a.urlPath.localeCompare(b.urlPath);
  const inLocale = tracked.filter((page) => page.locale === locale).sort(byUrl);
  if (inLocale.length > 0) {
    return inLocale[0];
  }
  const shared = tracked
    .filter((page) => page.locale === undefined)
    .sort(byUrl);
  return shared[0] ?? null;
}
