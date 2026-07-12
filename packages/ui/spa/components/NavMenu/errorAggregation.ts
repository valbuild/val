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
 * Directories don't contribute their own errors. Falls back to the legacy
 * boolean `hasError` for callers that haven't moved to the new `errors`
 * shape (mockData primarily).
 */
export function totalExplorerErrorCount(item: ExplorerItem): number {
  let count = item.errors?.ownCount ?? (item.hasError ? 1 : 0);
  for (const child of item.children) {
    count += totalExplorerErrorCount(child);
  }
  return count;
}
