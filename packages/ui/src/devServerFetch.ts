/**
 * Fetch from the Val UI dev server, tolerating a connection that drops.
 *
 * Only `server.ts` uses this, and `server.ts` is the local-development shim —
 * a built package serves the SPA from an embedded record in `vite-server.ts`
 * and never makes this request. So this is a dev-and-CI concern only.
 *
 * ## Why a retry is worth having at all
 *
 * The request this wraps is what puts the Studio's JavaScript on the page. When
 * it fails, `next dev` answers `/api/val/static/...` with nothing usable, the
 * SPA never boots, and every test in flight fails on whatever it was waiting
 * for — which is never the request. One `ETIMEDOUT` on a loaded CI runner cost
 * two separate e2e specs on two consecutive days, each time presenting as
 * "the store system never took the project in" from `openStudio`, and each time
 * pointing at the spec that happened to be running rather than at the fetch.
 *
 * ## Only a thrown error is retried
 *
 * A response is a response, however bad its status. A 500 from Vite means the
 * module graph does not build, and repeating the request would turn a clear
 * failure into a slow one — so anything that comes back is returned as-is, and
 * only a `fetch` that *throws* (`ECONNREFUSED` while the dev server is still
 * binding its port, `ETIMEDOUT` when the connection is dropped) is tried again.
 *
 * ## And no timeout of our own
 *
 * Tempting, and left out on purpose. A cold Vite transform of the SPA's module
 * graph legitimately takes many seconds on a loaded machine, so any deadline
 * short enough to be useful would also abort requests that were about to
 * succeed — and then repeat the transform, making the problem worse. The
 * failure this exists for arrives as a thrown error already.
 */

/** Attempts in total, not retries after the first. */
export const DEV_SERVER_ATTEMPTS = 4;

/**
 * Multiplied by the attempt number, so the waits are 250ms, 500ms, 750ms:
 * 1.5s of slack in the worst case, against `openStudio`'s 60s.
 */
export const DEV_SERVER_RETRY_DELAY_MS = 250;

type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<Response>;

export type DevServerFetchDeps = {
  /** Injected so the retry can be tested without a socket. */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

export async function devServerFetch(
  url: string,
  headers: Record<string, string>,
  deps: DevServerFetchDeps = {},
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= DEV_SERVER_ATTEMPTS; attempt++) {
    try {
      return await fetchImpl(url, { headers });
    } catch (err) {
      lastError = err;
      if (attempt < DEV_SERVER_ATTEMPTS) {
        await sleep(DEV_SERVER_RETRY_DELAY_MS * attempt);
      }
    }
  }
  // Named, because the previous version of this message said only "could not
  // fetch from dev server" and left it to the reader to work out which URL and
  // whether it had been tried more than once.
  console.error(
    `Could not fetch ${url} from the Val UI dev server after ${DEV_SERVER_ATTEMPTS} attempts. Make sure you are running \`pnpm dev\` in the packages/ui directory.`,
  );
  throw lastError;
}
