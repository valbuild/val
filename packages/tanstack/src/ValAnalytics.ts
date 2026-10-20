/**
 * What `<ValProvider analytics>` is handed: whether content analytics is on
 * for this site, and the content version the page is rendered from.
 *
 * Both come from the server, read in the site layout's loader. On a site Val
 * hosts, `fetchValAnalytics()` in the `val.server.ts` the platform writes
 * reads them from what the platform hands each render: the project's
 * `VAL_ANALYTICS` setting, and `VAL_CONTENT_VERSION`, the id of the content
 * version being served.
 */
export type ValAnalytics = {
  /** Off unless this says so. */
  enabled: boolean;
  /**
   * The id of the content version this page is rendered from. Every count is
   * stored with it, which is what lets a dashboard compare a page before and
   * after a publish, and name what was at an array position on a given day.
   *
   * Left out where there is no such id -- outside Val's hosting -- and the
   * counts then carry none.
   */
  contentVersion?: string;
};
