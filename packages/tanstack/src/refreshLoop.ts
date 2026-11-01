import { shouldSafetyRefresh } from "./safetyRefresh";

/**
 * The floor between server re-renders.
 *
 * `router.invalidate()` re-runs every loader of the current match tree — there
 * is no per-module invalidation — so this is about not queueing a round trip
 * per keystroke, not about batching for its own sake.
 */
export const REFRESH_INTERVAL_MS = 500;

/**
 * How often the page re-reads the server on its own, without being told to.
 *
 * A safety net for a race no amount of care on this side can close. An edit is
 * applied to the client store immediately and saved to the server
 * asynchronously, so `router.invalidate()` fired on the edit can reach a server
 * that has not written the patch yet: the loaders come back with the old
 * content, the counter has already been cleared, and nothing schedules another
 * look. What you see is a canvas that flickered and did not change — which is
 * indistinguishable from an edit that did not work.
 *
 * The honest fix would be for the page to know when its patch has been
 * persisted, and it has no way to ask. So it asks again a little later instead.
 */
export const SAFETY_REFRESH_MS = 10_000;

/**
 * How long after an edit the safety net keeps looking.
 *
 * The reason to stop is that this re-runs every loader on the page: in
 * development that is a server round trip and a recompile, and a preview
 * nobody is editing has nothing to catch up on. So the net is armed by editing
 * and disarms itself when the editing stops — long enough after the last
 * keystroke that any write still in flight has certainly landed.
 */
export const SAFETY_REFRESH_WINDOW_MS = 30_000;

export type RefreshLoop = {
  /** An edit was applied to the page's store: start the round trip now. */
  editLanded(): void;
  /** The tab became visible again: one look if a safety tick was skipped. */
  visible(): void;
  stop(): void;
};

/**
 * Re-render the server tree when an edit lands, then at most every 500ms, and
 * look again on a slow timer while editing is recent (the safety net).
 *
 * Leading edge, which is the whole point. This polled every 500ms and only
 * refreshed on the tick, so a keystroke waited up to half a second before the
 * round trip even began — pure dead time on top of a request that is already
 * the slow part in development. Refreshing on arrival and *then* enforcing the
 * gap keeps the same ceiling on requests while removing the wait.
 *
 * Still a counter rather than a boolean: edits that arrive during the gap have
 * to be picked up by the next refresh, and the count is what says whether
 * there are any. The counter is the caller's (`ValTanStackProvider` keeps it
 * in a ref and bumps it where an edit lands); `refresh` clears it.
 *
 * Its own function, out of the provider's effect, so the scenario harness
 * (`scenarios/`) refreshes a page exactly when the provider would.
 */
export function startRefreshLoop(options: {
  /** Edits landed since the last refresh. */
  pending: { current: number };
  /** Re-run the loaders: `router.invalidate()`, in a transition. */
  refresh: () => void;
  /** Whether a refresh is still on its way. */
  isRefreshing: () => boolean;
  /** `document.hidden`. */
  isHidden: () => boolean;
}): RefreshLoop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshAt = 0;
  /** When an edit last landed here. 0 means this page has never been edited. */
  let lastEditAt = 0;
  /** Whether a safety tick was skipped because nobody was looking. */
  let missedWhileHidden = false;
  const refresh = () => {
    options.pending.current = 0;
    lastRefreshAt = Date.now();
    options.refresh();
  };
  const tick = () => {
    timer = null;
    if (options.pending.current === 0) return;
    const since = Date.now() - lastRefreshAt;
    if (since >= REFRESH_INTERVAL_MS) {
      refresh();
    } else {
      timer = setTimeout(tick, REFRESH_INTERVAL_MS - since);
    }
  };
  // A backstop for the counter being bumped without the event — the two are
  // incremented in the same places today, but the poll is what made this
  // correct regardless of who bumped it.
  const interval = setInterval(tick, REFRESH_INTERVAL_MS);

  /**
   * The safety net: look again, whether or not anything told us to.
   *
   * The reasons not to are in `shouldSafetyRefresh`, where they can be tested.
   * `hidden` is the one this side has to remember something about: a skipped
   * tick is worth one look when the tab comes back.
   */
  const safetyTick = () => {
    if (options.isHidden()) {
      missedWhileHidden = true;
      return;
    }
    const go = shouldSafetyRefresh({
      now: Date.now(),
      lastEditAt,
      lastRefreshAt,
      hidden: false,
      isRefreshing: options.isRefreshing(),
      windowMs: SAFETY_REFRESH_WINDOW_MS,
      minIntervalMs: REFRESH_INTERVAL_MS,
    });
    if (go) refresh();
  };
  const safety = setInterval(safetyTick, SAFETY_REFRESH_MS);

  return {
    editLanded() {
      lastEditAt = Date.now();
      if (timer !== null) return;
      timer = setTimeout(tick, 0);
    },
    /**
     * Coming back to the tab is worth one look.
     *
     * Otherwise a background tab skips its ticks and then has to wait out a
     * whole interval on return — which is exactly the moment someone is
     * looking at the page to see whether their edit took.
     */
    visible() {
      if (!missedWhileHidden) return;
      missedWhileHidden = false;
      safetyTick();
    },
    stop() {
      clearInterval(interval);
      clearInterval(safety);
      if (timer !== null) clearTimeout(timer);
    },
  };
}
