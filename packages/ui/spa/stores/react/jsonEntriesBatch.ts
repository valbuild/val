import type { Json, ModuleFilePath } from "@valbuild/core";
import { JSON_ENTRIES_BATCH_MAX } from "@valbuild/shared/internal";
import type { FetchJsonEntry } from "../SourceStore";

/**
 * How many characters of `&keys=<key>` one `GET /json` may carry.
 *
 * Same reasoning — and the same failure — as {@link PATCH_ID_QUERY_BUDGET}: a
 * long enough query string never reaches the handler at all (Node caps the
 * request head at 16KB and answers 431; proxies cap it lower and answer 413),
 * so the request fails in a place that says nothing about the request. Well
 * under the 2000 characters that is safe for a URL anywhere.
 *
 * Unlike patch ids, keys are arbitrary strings of no fixed width, so the budget
 * is spent against each key's real encoded length rather than a per-id constant.
 */
export const JSON_ENTRY_KEYS_QUERY_BUDGET = 1500;

/**
 * How many entries one request asks for.
 *
 * Deliberately well below the route's own {@link JSON_ENTRIES_BATCH_MAX} of 100,
 * because a batch that is too big trades one problem for another. 120 entries in
 * two requests is two LONG requests — the first carries a hundred entries'
 * content — and everything the editor needs meanwhile waits behind them on the
 * same six connections. That is the head-of-line blocking this exists to remove,
 * just moved.
 *
 * 25 keeps the connection budget busy with several short requests instead of one
 * long one, and still turns 120 reads into 5 requests rather than 120.
 */
export const JSON_ENTRY_KEYS_PER_REQUEST = 25;

/** What one key costs in the query string. */
function keyCost(key: string): number {
  return "&keys=".length + encodeURIComponent(key).length;
}

/**
 * Split keys across as many requests as the limits need.
 *
 * Three of them: {@link JSON_ENTRY_KEYS_PER_REQUEST}, which is what actually
 * bites; {@link JSON_ENTRIES_BATCH_MAX}, the route's own schema limit, so
 * exceeding it is rejected by the client before it reaches the network; and the
 * URL budget above.
 *
 * Chunked rather than "ask for everything" — the answer `planPatchIdQuery` gives
 * for patch ids — because there is no unfiltered read here that is cheaper than
 * the ask: `GET /json` without `keys` takes an `offset`+`limit` window instead,
 * and a module with 5000 entries would then send back 5000 entries' content to
 * satisfy a request for 40 of them.
 *
 * A single key over budget still gets its own chunk: the request will likely
 * fail, but failing with the server's answer beats dropping the read here.
 */
export function chunkJsonEntryKeys(keys: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let spent = 0;
  const perRequest = Math.min(
    JSON_ENTRY_KEYS_PER_REQUEST,
    JSON_ENTRIES_BATCH_MAX,
  );
  for (const key of keys) {
    const cost = keyCost(key);
    const full =
      current.length >= perRequest ||
      spent + cost > JSON_ENTRY_KEYS_QUERY_BUDGET;
    if (current.length > 0 && full) {
      chunks.push(current);
      current = [];
      spent = 0;
    }
    current.push(key);
    spent += cost;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export type JsonEntryResult =
  | { status: "ok"; content: Json }
  | { status: "error"; message: string };

/** One request for many keys of one module. */
export type FetchJsonEntries = (
  moduleFilePath: ModuleFilePath,
  keys: string[],
) => Promise<Record<string, JsonEntryResult>>;

type Waiting = {
  keys: Map<string, ((res: JsonEntryResult) => void)[]>;
  scheduled: boolean;
};

/**
 * Turn N one-key reads into one request per module per tick.
 *
 * NOT WIRED YET, and deliberately so — see
 * `architecture/known-issues.md`, "`GET /json` is one request per entry". It is
 * kept because the measurement and the tests are the expensive part and both are
 * done; what blocks it is a latent race in the shell's canvas-closing effect that
 * batching exposes, and that has to be fixed first.
 *
 * `GET /json` has always taken a `keys` array, and the seam has always sent
 * exactly one key. A record's visible rows each resolve their own path, so
 * opening one issued a request per row and every scroll issued another wave —
 * measured at 46 requests for 46 keys — all at once, all to the same origin. A
 * browser runs about six connections per origin over HTTP/1.1, so the rest sat in
 * the browser's own queue, and anything the editor asked for AFTER them queued
 * behind: `GET /patches`, `POST /stat`, the next navigation. In the devtools that
 * reads as a request stuck in "pending" with no server time against it at all.
 * Wiring this took the same 46 keys to 4 requests.
 *
 * Batching is per MODULE because that is what the endpoint takes (one `path`,
 * many `keys`), and per TICK because that is when the reads arrive: a record's
 * rows all resolve their paths in one render pass, so the wave is already
 * grouped in time and only needs collecting. `SourceStore` still de-duplicates
 * the same key, so this only ever sees distinct ones.
 *
 * The flush is a microtask by default: it runs before the browser does anything
 * else, so it costs no observable delay, and a render pass's reads are all in one
 * task so it is enough. A `setTimeout` collects a little more — the reads an
 * effect makes after the render that asked for them — at the cost of a macrotask
 * of latency on every entry read. Neither is what blocks this from being wired:
 * the canvas regression reproduces under both.
 *
 * It is injected so a test can drive it rather than wait for it.
 */
export function batchJsonEntries(
  fetchJsonEntries: FetchJsonEntries,
  schedule: (flush: () => void) => void = queueMicrotask,
): FetchJsonEntry {
  const waiting = new Map<ModuleFilePath, Waiting>();

  async function flush(moduleFilePath: ModuleFilePath): Promise<void> {
    const pending = waiting.get(moduleFilePath);
    if (pending === undefined) {
      return;
    }
    waiting.delete(moduleFilePath);
    const keys = [...pending.keys.keys()];
    /*
     * Chunks go out together, not one after the other.
     *
     * Sequential chunks make the last reader of a big module wait for every
     * chunk before it, which is the same head-of-line blocking in a new place —
     * and there is nothing to serialize FOR: each chunk is an independent read
     * of different keys. The browser's own connection limit is the bound here.
     */
    await Promise.all(
      chunkJsonEntryKeys(keys).map(async (chunk) => {
        let results: Record<string, JsonEntryResult>;
        try {
          results = await fetchJsonEntries(moduleFilePath, chunk);
        } catch (err) {
          // A throwing seam must not leave readers awaiting forever: a read that
          // never settles is the one shape a field can neither render nor retry.
          const message =
            err instanceof Error
              ? err.message
              : "Unknown error reading entries";
          results = Object.fromEntries(
            chunk.map((key) => [key, { status: "error", message } as const]),
          );
        }
        for (const key of chunk) {
          const resolvers = pending.keys.get(key) ?? [];
          const result: JsonEntryResult = results[key] ?? {
            status: "error",
            message: `Entry not found: ${key} in ${moduleFilePath}`,
          };
          for (const resolve of resolvers) {
            resolve(result);
          }
        }
      }),
    );
  }

  return (moduleFilePath, key) =>
    new Promise<JsonEntryResult>((resolve) => {
      let pending = waiting.get(moduleFilePath);
      if (pending === undefined) {
        pending = { keys: new Map(), scheduled: false };
        waiting.set(moduleFilePath, pending);
      }
      const resolvers = pending.keys.get(key);
      if (resolvers === undefined) {
        pending.keys.set(key, [resolve]);
      } else {
        resolvers.push(resolve);
      }
      if (!pending.scheduled) {
        pending.scheduled = true;
        schedule(() => {
          void flush(moduleFilePath);
        });
      }
    });
}
