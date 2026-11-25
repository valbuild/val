import { Internal } from "@valbuild/core";
import { isCrossRequestError } from "@valbuild/shared/internal";

/*
 * workerd's refusals of work that belongs to another request.
 *
 * On a host that runs the site in a workerd isolate (Val's hosting,
 * Cloudflare Workers), one isolate serves many requests from one module
 * scope, and a promise or an I/O object belongs to the request that made it.
 * Awaiting one made by a request that has since ended fails at once -- with
 * no request to anything having been made -- and so does using an I/O object
 * of another request. Neither says anything about the network or the content
 * service: it is a promise Val kept across requests (see `SettledCache` in
 * `@valbuild/shared/internal`), so it must never be reported to a person as
 * "could not be reached".
 */
/** See `isCrossRequestError` in `@valbuild/shared/internal`, where it lives. */
export { isCrossRequestError };

/**
 * `fetch`, made again -- fresh, from this request -- when the first one was
 * refused as another request's (see {@link isCrossRequestError}). Only a
 * read: whether a write that was refused that way was sent is not known, and
 * sending it twice is worse than failing it once.
 */
export async function fetchFresh(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : undefined) ??
      "GET"
    ).toUpperCase();
    if (!isCrossRequestError(err) || (method !== "GET" && method !== "HEAD")) {
      throw err;
    }
    Internal.log.debug("a fetch was refused as another request's: again", err);
    return await fetch(input, init);
  }
}
