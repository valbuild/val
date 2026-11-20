import type { Json, ModuleFilePath } from "@valbuild/core";
import { JSON_ENTRIES_BATCH_MAX } from "@valbuild/shared/internal";

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
 * Chunked for the same reason `chunkPatchIds` chunks patch ids, and "ask for
 * everything" is no cheaper here either: `GET /json` without `keys` takes an
 * `offset`+`limit` window instead,
 * and a module with 5000 entries would then send back 5000 entries' content to
 * satisfy a request for 40 of them.
 *
 * A single key over budget still gets its own chunk: the request will likely
 * fail, but failing with the server's answer beats dropping the read here.
 */
export function chunkJsonEntryKeys(
  keys: readonly string[],
  /** At most this many keys a request; never more than the route takes. */
  keysPerRequest: number = JSON_ENTRY_KEYS_PER_REQUEST,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let spent = 0;
  const perRequest = Math.max(
    1,
    Math.min(keysPerRequest, JSON_ENTRIES_BATCH_MAX),
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

/**
 * One request for many keys of one module: `GET /json` with `keys`. A key the
 * answer does not mention is a failure, never a read that does not settle.
 */
export type FetchJsonEntries = (
  moduleFilePath: ModuleFilePath,
  keys: string[],
) => Promise<Record<string, JsonEntryResult>>;

/**
 * A one-key seam as a many-key one: one request per key, all at once.
 *
 * For the systems whose seam reads one entry at a time (a history snapshot,
 * the read-only system, the test rig). The Studio's own seam,
 * `createValSystem`'s, sends the keys it is given in ONE `GET /json`.
 */
export function oneRequestPerKey(
  fetchJsonEntry: (
    moduleFilePath: ModuleFilePath,
    key: string,
  ) => Promise<JsonEntryResult>,
): FetchJsonEntries {
  return async (moduleFilePath, keys) => {
    const results = await Promise.all(
      keys.map((key) => fetchJsonEntry(moduleFilePath, key)),
    );
    const byKey: Record<string, JsonEntryResult> = {};
    keys.forEach((key, i) => {
      byKey[key] = results[i];
    });
    return byKey;
  };
}
