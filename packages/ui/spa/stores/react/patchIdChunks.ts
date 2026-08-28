import { PatchId } from "@valbuild/core";

/**
 * Split a list of patch ids across requests whose query strings actually fit.
 *
 * `GET /patches` takes its ids as repeated `patch_id` params and `DELETE
 * /patches` as repeated `id` params, and nothing bounded how many. A project
 * with a few hundred pending changes asked for all of them at once — a ~19KB
 * request line — and the request never reached the handler: Node caps the whole
 * request head at 16KB (431) and proxies in front of it cap it lower (413). The
 * failure is in the request line rather than in anything the server said, so it
 * looked like the editor loading forever with no pending changes.
 *
 * Chunking rather than dropping the filter: an unfiltered request happens to
 * return the same set today, but only because the endpoint answers an unfiltered
 * query with everything it holds — which makes "did I get what I asked for"
 * unanswerable, and that question is the one that catches a server sending back
 * less than it announced. For `DELETE` it is not even available: there is no
 * unfiltered delete, and "delete everything" is not something a client should be
 * able to ask for by accident.
 */

/**
 * How many characters of repeated id params one URL may carry.
 *
 * **The limit this is under is the ~2000 characters that are safe for a URL
 * anywhere** — not Node's 16KB request head. Three reasons for aiming at the
 * smaller one:
 *
 * - 16KB is `--max-http-header-size`. It is configurable, and it covers the
 *   whole head, so the `val_session` cookie is spent from the same allowance.
 *   A budget reasoned against it silently depends on server configuration.
 * - A proxy or CDN in front of the app — which `http` mode really has — caps it
 *   lower and answers 413.
 * - `JSON_ENTRY_KEYS_QUERY_BUDGET` already reasons this way. One rule for the
 *   whole family beats three numbers implying three different limits, which is
 *   what this file and `patchesQuery.ts` used to be between them.
 *
 * The cost, stated rather than hidden: 32 ids per `GET`, 37 per `DELETE`, so a
 * 650-patch first load is 21 requests rather than 5. That is what a limit which
 * holds everywhere is worth, and 650 pending changes is the stress fixture
 * rather than a normal project.
 */
export const PATCH_ID_QUERY_BUDGET = 1500;

/** A uuid, which is what every patch id is. */
const ID_LENGTH = 36;

/**
 * What one id costs on the query string, derived from the param carrying it.
 *
 * Derived rather than passed as a number: the param name is the only thing that
 * actually differs between the two callers, so it is the only thing they should
 * have to get right.
 */
function perId(paramName: string): number {
  return `&${paramName}=`.length + ID_LENGTH;
}

export function patchIdsPerRequest(paramName: string): number {
  return Math.max(1, Math.floor(PATCH_ID_QUERY_BUDGET / perId(paramName)));
}

/**
 * @param paramName the query parameter each id is repeated under —
 *   `patch_id` for `GET /patches`, `id` for `DELETE /patches`.
 */
export function chunkPatchIds(
  patchIds: readonly PatchId[],
  paramName: string,
): PatchId[][] {
  if (patchIds.length === 0) {
    // Not one empty request: `GET /patches` answers an unfiltered query with the
    // whole table, and `DELETE /patches` requires at least one id and would 400.
    return [];
  }
  const perRequest = patchIdsPerRequest(paramName);
  const chunks: PatchId[][] = [];
  for (let i = 0; i < patchIds.length; i += perRequest) {
    chunks.push(patchIds.slice(i, i + perRequest));
  }
  return chunks;
}
