import { ExplorerItem, SitemapItem } from "./types";

/**
 * Recursively sum the validation errors under a sitemap item, including its
 * own. Used to drive the count badge on every row and the total in the
 * "Pages" section header.
 *
 * The result is stable across renders as long as the input `item` reference
 * is stable — `useNavMenuData` memoizes the tree, so calling this from a
 * `useMemo([item])` is cheap in practice.
 */
export function totalSitemapErrorCount(item: SitemapItem): number {
  let count = item.errors?.ownCount ?? 0;
  for (const child of item.children) {
    count += totalSitemapErrorCount(child);
  }
  return count;
}

/**
 * Recursively sum the validation errors under an explorer item.
 *
 * Directories contribute nothing of their own. That is not a stylistic choice:
 * The nav tree sets the legacy `hasError` on a directory whenever ANY
 * descendant has errors, so counting it as one would add +1 for every folder on
 * the path to each error - a file three folders deep reported as four errors.
 * The fallback is therefore for leaf nodes only.
 */
export function totalExplorerErrorCount(item: ExplorerItem): number {
  let count = ownExplorerErrorCount(item);
  for (const child of item.children) {
    count += totalExplorerErrorCount(child);
  }
  return count;
}

/**
 * The errors that resolve to this explorer node itself - zero for a directory,
 * whose `hasError` only ever means "something below me". Shared with the row so
 * the badge and the name tint agree.
 */
export function ownExplorerErrorCount(item: ExplorerItem): number {
  if (item.errors) {
    return item.errors.ownCount;
  }
  if (item.isDirectory) {
    return 0;
  }
  return item.hasError ? 1 : 0;
}
