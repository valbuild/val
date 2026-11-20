import { getErrorMessageFromUnknownJson } from "@valbuild/shared/internal";

/**
 * What to tell a person when the content service did not do what was asked.
 *
 * Written because the old sentences guessed, and guessed wrong. The patches
 * request answered "It is most likely due to a network issue. Check your
 * network connection" for ANY non-2xx answer -- including a 500 from a content
 * service whose database was missing a column, while the editor's network was
 * fine. A status code is an answer, and an answer means the network worked.
 *
 * So there are two shapes and they say different things:
 *
 * - **The service answered** with an error (`status`). It is named, the
 *   sentence says it answered with an error or refused, and the status line
 *   and the service's own words go in `details` for whoever has to report it.
 * - **The service could not be reached** (`unreachable`: `fetch` threw). That
 *   IS a connection failure -- but between this site's server and the
 *   service, not the editor's: the editor reached this server, or nothing
 *   would have asked. So it never says "your connection" either.
 *
 * `retryable` is what decides whether a caller offers Try again: a 5xx, a
 * timeout or a service that could not be reached may well work the next time;
 * a 4xx is the same refusal again, and a button that leads to the same error
 * is worse than none.
 */
export type ContentServiceFailure = {
  /** For the person, in their terms. No status codes, no stack traces. */
  message: string;
  /** For support: the status line and the service's own words, capped. */
  details: string;
  retryable: boolean;
};

/** Long enough for a database error, short enough for a dialog. */
const MAX_BODY_LENGTH = 500;

/**
 * The content service, by a name a person would recognise.
 *
 * `content.val.build` is Val Build. Anything else -- a self-hosted engine, a
 * staging host, the e2e mock -- is named by its host, so the person can tell
 * WHICH service failed rather than being told "the server", which in a page
 * that is itself a server says nothing.
 */
export function contentServiceName(contentUrl: string): string {
  let host: string;
  try {
    host = new URL(contentUrl).host;
  } catch {
    return "the content service";
  }
  if (host === "val.build" || host.endsWith(".val.build")) {
    return "Val Build";
  }
  return `the content service at ${host}`;
}

/**
 * The service answered `status`.
 *
 * `what` completes "could not ...": "load your changes", "save your change".
 * `body` is the raw response text; a JSON body is read the way the rest of
 * `ValOpsHttp` reads one, so `home`'s `{ message: "Internal Server Error",
 * details: "<the real cause>" }` keeps the real cause.
 */
export function contentServiceAnswered(
  service: string,
  what: string,
  response: { status: number; statusText: string; body: string },
): ContentServiceFailure {
  const retryable =
    response.status >= 500 ||
    response.status === 408 ||
    response.status === 429;
  const Service = capitalize(service);
  const message = retryable
    ? `${Service} answered with an error, so Val could not ${what}.`
    : `${Service} refused to ${what}.`;
  const statusLine = `HTTP ${response.status}${
    response.statusText ? ` ${response.statusText}` : ""
  } from ${service}`;
  const said = bodyText(response.body);
  return {
    message,
    details: said === null ? statusLine : `${statusLine}: ${said}`,
    retryable,
  };
}

/** `fetch` threw: the service was never heard from. */
export function contentServiceUnreachable(
  service: string,
  what: string,
  error: unknown,
): ContentServiceFailure {
  return {
    message: `${capitalize(service)} could not be reached from this site's server, so Val could not ${what}.`,
    details: errorText(error),
    retryable: true,
  };
}

function bodyText(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;
  let text = trimmed;
  try {
    const json: unknown = JSON.parse(trimmed);
    text = getErrorMessageFromUnknownJson(json, trimmed);
  } catch {
    // Not JSON: the text is what the service said.
  }
  return text.length <= MAX_BODY_LENGTH
    ? text
    : `${text.slice(0, MAX_BODY_LENGTH)}…`;
}

/**
 * The reason a `fetch` threw, with its cause.
 *
 * Node's `fetch` throws `TypeError: fetch failed` and hides what failed in
 * `cause` (`ECONNREFUSED`, a DNS miss, a certificate), which is the half
 * support needs.
 */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause: unknown = error.cause;
  if (cause instanceof Error && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * One string, for the error shapes that carry only a `message`: the sentence
 * first, the evidence after it in brackets.
 */
export function contentServiceFailureText(
  failure: ContentServiceFailure,
): string {
  return `${failure.message} (${failure.details})`;
}
