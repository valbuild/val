/**
 * Whether the page should re-read the server on its own, right now.
 *
 * The page cannot know when its own edit has been persisted. An edit is applied
 * to the client store immediately and written to the server asynchronously, so
 * a `router.refresh()` fired on the edit can reach a server that has not saved
 * the patch yet: the payload comes back with the old content, and nothing
 * schedules another look. What an editor sees is a canvas that flickered and did
 * not change — which is indistinguishable from an edit that did not work.
 *
 * So the page asks again a little later. This is the "should I bother" half of
 * that, kept out of the effect and pure so the reasons NOT to are checkable:
 * every one of them is a whole-route request avoided, and in development Next
 * re-renders (and sometimes recompiles) the page for each one.
 */
export function shouldSafetyRefresh(state: {
  now: number;
  /** When an edit last landed on this page. 0 = never edited. */
  lastEditAt: number;
  /** When this page last asked the server for the route. */
  lastRefreshAt: number;
  /** `document.hidden`. */
  hidden: boolean;
  /** Whether a refresh is already on its way. */
  isRefreshing: boolean;
  /** How long after the last edit to keep looking. */
  windowMs: number;
  /** The floor between requests, shared with the edit-driven path. */
  minIntervalMs: number;
}): boolean {
  // Never edited: a preview someone is only looking at has nothing to catch up
  // on, and polling it would cost a route render per tick for nothing.
  if (state.lastEditAt === 0) return false;
  // The editing stopped long enough ago that anything in flight has landed.
  if (state.now - state.lastEditAt > state.windowMs) return false;
  // Nobody is looking. The caller refreshes once on the way back instead.
  if (state.hidden) return false;
  // Already on its way. Stacking whole-route requests makes the slowness this
  // exists to paper over worse, not better.
  if (state.isRefreshing) return false;
  // One just went out — usually the edit-driven refresh, a moment ago.
  if (state.now - state.lastRefreshAt < state.minIntervalMs) return false;
  return true;
}
