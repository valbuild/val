import { reportPlanRefusal } from "../utils/planRefusal";

/*
 * The one JSON call the Studio makes through its own origin's publish proxy,
 * and the errors it throws. Apart from `publishClient.ts` (which re-exports
 * all three) so that a worker can make the same call without importing the
 * publish client's parsers, and `@valbuild/shared` with them.
 */

/** The publish API refused, and said why. */
export class StudioPublishError extends Error {
  readonly statusCode: number;
  readonly body: unknown;
  constructor(statusCode: number, message: string, body: unknown) {
    super(message);
    this.name = "StudioPublishError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

/**
 * Was this a failure that asking again could get past?
 *
 * No answer at all (the request never got through) and the answers that mean
 * "not now" -- a timeout, too many requests, a server or gateway error. Every
 * other status is content answering, and the same request gets the same
 * answer.
 */
export function isTransientPublishError(error: unknown): boolean {
  if (!(error instanceof StudioPublishError)) return true;
  return (
    error.statusCode >= 500 ||
    error.statusCode === 408 ||
    error.statusCode === 429
  );
}

/**
 * One JSON call through this origin, with the session cookie: its body, or a
 * `StudioPublishError` carrying the answer's own message.
 */
export async function callJson(
  fetchImpl: typeof fetch,
  url: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method,
    // The session cookie is the whole credential this end has.
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await res.text();
  /*
   * A body that is not JSON is a gateway between here and content, not
   * content answering -- so it becomes `undefined` and the status carries the
   * meaning, rather than throwing over a page nobody wrote.
   */
  let parsed: unknown;
  try {
    parsed = text === "" ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    // A publish the plan does not allow (a trial's 3 publishes, a trial that
    // ended): the shell says it, with the next step. See `planRefusal`.
    reportPlanRefusal(parsed);
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
        ? parsed.message
        : `The publish API answered ${res.status}.`;
    throw new StudioPublishError(res.status, message, parsed);
  }
  return parsed;
}
