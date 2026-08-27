import type { PatchId } from "@valbuild/core";

/**
 * How many characters of `&patch_id=<uuid>` the URL may carry.
 *
 * `GET /patches` filters by repeated `patch_id` params, so asking for N patches
 * puts N uuids in the query string — 45 characters each. A project with a few
 * hundred pending patches therefore produced a 30KB URL on its first load, and
 * the request never reached the handler: Node caps the whole request head at
 * 16KB (431), and proxies in front of it cap it lower still (413). Which looked
 * like the editor loading forever with no pending changes, because the failure
 * was in the request line rather than in anything the server said.
 *
 * 1500 is not the limit, it is well under the lowest of them — the 2000
 * characters that is safe for a URL anywhere. There is nothing to gain from
 * asking for exactly as many ids as a particular server would have accepted.
 */
export const PATCH_ID_QUERY_BUDGET = 1500;

/** `&patch_id=` plus a uuid. */
const PER_ID = "&patch_id=".length + 36;

/** `&id=` plus a uuid, for `DELETE /patches`. */
const PER_DELETE_ID = "&id=".length + 36;

/**
 * Which `patch_id` params to send for a request that wants `patchIds`.
 *
 * `undefined` means send NONE — the endpoint answers an unfiltered request with
 * every patch it holds, so a caller that wants more than the URL can carry asks
 * for everything and keeps the ones it wanted. That is not a workaround so much
 * as the cheaper request in the case that produces it: the ask is only ever this
 * large on the first load, where the ids requested ARE every patch the server
 * has, and one unfiltered response is the same data in a request that fits.
 *
 * Chunking was the alternative and is worse here: it turns one load into a dozen
 * round trips, each returning a slice the client then has to stitch, for a
 * result identical to the unfiltered response. (The server does chunk when it
 * forwards to the content host — see `ValOpsHttp.fetchPatches` — because there
 * the unfiltered set is every patch on the branch, not just the applicable
 * ones.)
 */
export function planPatchIdQuery(
  patchIds: readonly PatchId[],
): PatchId[] | undefined {
  if (patchIds.length === 0) {
    // Not "ask for everything": a caller asking for nothing wants nothing, and
    // an unfiltered request would hand it the whole table.
    return [];
  }
  if (patchIds.length * PER_ID > PATCH_ID_QUERY_BUDGET) {
    return undefined;
  }
  return [...patchIds];
}

/**
 * Split ids across as many `DELETE /patches` requests as the URL budget needs.
 *
 * Same 30KB-URL failure as the read above — "discard all" on a long chain built
 * a query string nothing would accept — but the answer has to be different:
 * there is no unfiltered delete, and inventing one ("delete everything") is not
 * a thing a client should be able to ask for by accident.
 *
 * Sequential chunks, not parallel: each request deletes patches the next one's
 * chain is computed against, and a half-applied fan-out is harder to reason
 * about than a stop at the first failure.
 */
export function chunkPatchIdsForDelete(
  patchIds: readonly PatchId[],
): PatchId[][] {
  const perChunk = Math.max(
    1,
    Math.floor(PATCH_ID_QUERY_BUDGET / PER_DELETE_ID),
  );
  const chunks: PatchId[][] = [];
  for (let i = 0; i < patchIds.length; i += perChunk) {
    chunks.push(patchIds.slice(i, i + perChunk));
  }
  return chunks;
}
