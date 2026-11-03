/**
 * When a draft page re-reads what its server rendered: its loaders (TanStack
 * Start's `router.invalidate()`) or its server components (Next's
 * `router.refresh()`). The hooks need none of this -- they read what the
 * Studio relays -- but server-read content only changes on a refresh, and only
 * shows an edit once the server has it.
 *
 * So the page refreshes when the Studio says the server has CONFIRMED the
 * edit (`confirmed`, with the server's `seq`), never when the edit arrives.
 * Arrived, it raced the write: the page asked a server that did not have the
 * patch yet, got the old content back, and nothing asked again until a safety
 * refresh ten seconds later (S05 in `scenarios/`). That timer, and the 500 ms
 * throttle that was there to keep the edit-driven refreshes from stacking,
 * are gone: this has no timer at all. See `docs/plans/one-content-model.md`,
 * "The page converges on the Studio".
 *
 * - **One refresh per confirmed version.** A version told twice (a save's
 *   answer, then the stat after it) or out of order refreshes once.
 * - **At most one in flight**, where the refresh says when it is done (a
 *   promise): a version confirmed meanwhile waits for it and is then one more
 *   refresh, however many arrived. A refresh that cannot say (Next's
 *   `router.refresh()`) is simply sent each time.
 * - **The first `confirmed` is the connection, not news.** The Studio says
 *   it once after its catch-up. The page refreshes then only if the catch-up
 *   moved what it holds (`changed`): its server render is older than what the
 *   Studio has. A page rendered from the draft the Studio holds -- the
 *   `draft` prop, read for this request -- is not refreshed for loading.
 * - **A Studio of the release before never says `confirmed`** (a deploy
 *   rolling out: this page, that Studio). Its changes refresh the page as
 *   they arrive (`changedByPreviousStudio`), as that release's page did,
 *   until a `confirmed` says the Studio is this release's. They race the
 *   write, as they did then; it lasts as long as the rollout.
 */
export type RefreshLoop = {
  /** A relayed module moved what the page's store holds. */
  changed(): void;
  /**
   * A relayed module moved what the page's store holds, sent by a Studio of
   * the release before (a bare `source`), which never says `confirmed`: a
   * refresh, unless a `confirmed` has been told on this page. Goes with the
   * relay's `source` ("Release-delayed deletions").
   */
  changedByPreviousStudio(): void;
  /** The server holds the editor's changes up to `seq` (`null`: unknown). */
  confirmed(seq: number | null): void;
  /**
   * Something other than content changed what the server renders -- draft
   * mode was turned on or off -- so refresh now (coalesced like the rest).
   */
  refresh(): void;
  /** How many refreshes this loop has asked for: for the scenario budgets. */
  readonly refreshes: number;
  stop(): void;
};

export function startRefreshLoop(options: {
  /**
   * Re-read the server: the provider's refresh, in a transition. A promise
   * that settles when the refreshed content is in, where the framework says.
   */
  refresh: () => Promise<unknown> | void;
}): RefreshLoop {
  /** The version last told; `undefined` until the first. */
  let told: number | null | undefined = undefined;
  /** Whether the catch-up moved what the page holds: see above. */
  let behind = false;
  let running = false;
  let again = false;
  let stopped = false;
  let refreshes = 0;
  const run = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    refreshes++;
    const done = options.refresh();
    if (done === undefined) return;
    running = true;
    const next = () => {
      running = false;
      if (!again) return;
      again = false;
      run();
    };
    done.then(next, next);
  };
  return {
    changed() {
      if (told === undefined) behind = true;
    },
    changedByPreviousStudio() {
      if (told !== undefined) {
        // A Studio that confirms: its `confirmed` is the refresh.
        return;
      }
      run();
    },
    confirmed(seq) {
      if (told !== undefined && told !== null && seq !== null && seq <= told) {
        return;
      }
      const first = told === undefined;
      told = seq;
      if (first && !behind) return;
      run();
    },
    refresh() {
      run();
    },
    get refreshes() {
      return refreshes;
    },
    stop() {
      stopped = true;
    },
  };
}
