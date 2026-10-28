import { isListedUnder } from "../../utils/isAtLocation";
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
 * Returns the same array, and the same rows, wherever nothing was filtered, so
 * a memo downstream does not see a change that is not one.
 */
export function pagesInLocale(
  pages: ShellPage[],
  locale: string | null,
  location: string | null,
): ShellPage[] {
  if (locale === null) {
    return pages;
  }
  // Rows are reused where nothing under them changed, and so is an array none
  // of whose rows did: this runs on every navigation (the editor's location is
  // part of the rule), and a fresh tree each time re-rendered every row.
  const filter = (rows: ShellPage[]): ShellPage[] => {
    const kept = rows.flatMap((page): ShellPage[] => {
      const children =
        page.children === undefined ? undefined : filter(page.children);
      if (
        page.sourcePath !== undefined &&
        isListedUnder(locale, page.locale, location, page.sourcePath)
      ) {
        return [children === page.children ? page : { ...page, children }];
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
    return kept.length === rows.length &&
      kept.every((page, index) => page === rows[index])
      ? rows
      : kept;
  };
  return filter(pages);
}
