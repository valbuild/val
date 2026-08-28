import { PatchId } from "@valbuild/core";

/**
 * Split a list of patch ids into requests whose query strings actually fit.
 *
 * `GET /patches` takes its ids as repeated `patch_id` query params, and nothing
 * bounded how many. A project with a few hundred pending changes therefore asked
 * for all of them at once: at ~46 characters per id, 410 ids is a ~19KB request
 * line, past Node's 16KB header cap. The dev server answers that with a 431 or
 * drops the connection before the handler ever runs, and the studio then treats
 * every pending change as failed.
 *
 * Chunking rather than dropping the filter: an unfiltered request happens to
 * return the same set today, but only because the endpoint answers an unfiltered
 * query with everything it holds — which makes "did I get what I asked for"
 * unanswerable, and that question is the one that catches a server sending back
 * less than it announced.
 */

/**
 * Characters a single id costs on the query string: `&patch_id=` plus a uuid.
 * A generous fixed figure rather than a measurement, because being wrong in the
 * cheap direction only costs an extra request.
 */
const PER_ID = "&patch_id=".length + 36;

/**
 * Room for the ids, well inside the 16KB a Node server will accept, leaving the
 * rest for the path, the other params and the headers.
 */
const QUERY_BUDGET = 6000;

export const PATCH_IDS_PER_REQUEST = Math.max(
  1,
  Math.floor(QUERY_BUDGET / PER_ID),
);

export function chunkPatchIds(
  patchIds: readonly PatchId[],
): readonly PatchId[][] {
  if (patchIds.length === 0) {
    return [];
  }
  const chunks: PatchId[][] = [];
  for (let i = 0; i < patchIds.length; i += PATCH_IDS_PER_REQUEST) {
    chunks.push(patchIds.slice(i, i + PATCH_IDS_PER_REQUEST));
  }
  return chunks;
}
