import {
  VAL_RENDER_EVENT,
  VAL_RENDER_SHOWN_EVENT,
} from "@valbuild/shared/internal";
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
 */
export type RefreshLoop = {
  /** A relayed module moved what the page's store holds. */
  changed(): void;
  /** The server holds the editor's changes up to `seq` (`null`: unknown). */
  confirmed(seq: number | null): void;
  /**
   * Something other than content changed what the server renders -- draft
   * mode was turned on or off -- so refresh now (coalesced like the rest).
   */
  refresh(): void;
  /**
   * Resolves once the page shows the server's content at `seq`: a refresh
   * that started after the server confirmed `seq` (or later) has come back
   * -- or none was needed, the page having been rendered from that draft.
   * `null` (or a server that orders nothing): once the page is connected and
   * no refresh is out. What a render id waits on before it is written on the
   * page (`data-val-render`, read by the Studio's `read_page`).
   */
  shown(seq: number | null): Promise<void>;
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
  /**
   * The version the page's server-read content is at: what was confirmed
   * when the last refresh that came back started. `undefined` until there is
   * one.
   */
  let refreshedTo: number | null | undefined = undefined;
  const waiting: { seq: number | null; resolve: () => void }[] = [];
  const isShown = (seq: number | null) => {
    if (refreshedTo === undefined || running || again) return false;
    if (seq === null || refreshedTo === null) return true;
    return refreshedTo >= seq;
  };
  const settle = () => {
    for (const waiter of [...waiting]) {
      if (!isShown(waiter.seq)) continue;
      waiting.splice(waiting.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const run = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    refreshes++;
    const from = told;
    const done = options.refresh();
    if (done === undefined) {
      refreshedTo = from;
      settle();
      return;
    }
    running = true;
    const next = () => {
      running = false;
      refreshedTo = from;
      if (again) {
        again = false;
        run();
      }
      settle();
    };
    done.then(next, next);
  };
  return {
    changed() {
      if (told === undefined) behind = true;
    },
    confirmed(seq) {
      if (told !== undefined && told !== null && seq !== null && seq <= told) {
        return;
      }
      const first = told === undefined;
      told = seq;
      if (first && !behind) {
        // Rendered from the draft the Studio holds: already at `seq`.
        refreshedTo = seq;
        settle();
        return;
      }
      run();
    },
    refresh() {
      run();
    },
    shown(seq) {
      if (isShown(seq)) return Promise.resolve();
      return new Promise<void>((resolve) => waiting.push({ seq, resolve }));
    },
    get refreshes() {
      return refreshes;
    },
    stop() {
      stopped = true;
    },
  };
}

/**
 * Take the page's render ids (`renderMark.ts` in `@valbuild/shared`): for
 * each `render` the canvas bridge is told, hold it until the page's
 * server-read content shows its version (`shown`), then say the page shows
 * it (`VAL_RENDER_SHOWN_EVENT`), a frame later so what came back is drawn.
 * Without a loop (`loop()` answers `null`) the page has nothing to wait for,
 * and the bridge writes the id at once. Returns the unsubscribe.
 */
export function takeRenders(loop: () => RefreshLoop | null): () => void {
  const take = (event: Event) => {
    const current = loop();
    if (current === null || !(event instanceof CustomEvent)) return;
    const id: unknown = Reflect.get(Object(event.detail), "id");
    const seq: unknown = Reflect.get(Object(event.detail), "seq");
    if (typeof id !== "string") return;
    if (seq !== null && typeof seq !== "number") return;
    event.preventDefault();
    void current.shown(seq).then(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent(VAL_RENDER_SHOWN_EVENT, { detail: { id } }),
        );
      });
    });
  };
  window.addEventListener(VAL_RENDER_EVENT, take);
  return () => window.removeEventListener(VAL_RENDER_EVENT, take);
}
