/**
 * What `<ValProvider analytics>` is handed: whether content analytics is on
 * for this site, and the content version the page is rendered from.
 *
 * Both come from what Val's hosting hands each render: the project's
 * `VAL_ANALYTICS` setting, and `VAL_CONTENT_VERSION`, the id of the content
 * version being served. A provider that is passed nothing reads them itself
 * (`platformAnalytics.tsx`); a layout that wants to decide reads them in its
 * loader with `fetchValAnalytics()`, from the `val.server.ts` the platform
 * writes, and passes them.
 *
 * A self-hosted site has no platform handing it anything, so its layout reads
 * `VAL_ANALYTICS` from its own environment and passes the result: see
 * `analytics` on `<ValProvider>`.
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
