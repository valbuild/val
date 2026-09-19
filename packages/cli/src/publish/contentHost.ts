import { DEFAULT_CONTENT_HOST } from "@valbuild/core";

/**
 * The one host `val publish` talks to.
 *
 * Not a flag, and not several: publishing is a conversation with
 * content.val.build, which holds the operator relationship with whatever
 * actually serves the site and calls it on our behalf. A second host here
 * would be a second thing to configure in every repository that publishes,
 * and a second place for a credential to go.
 *
 * `VAL_CONTENT_URL` overrides it, as it does everywhere else in Val, so a
 * test can point the CLI at a fake and a developer at a local content service.
 */
export function getContentHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.VAL_CONTENT_URL;
  if (!configured) {
    return DEFAULT_CONTENT_HOST;
  }
  // A trailing slash turns every path below into a double slash, which some
  // routers answer with a redirect and others with a 404.
  return configured.replace(/\/+$/, "");
}

/**
 * A refusal from content, carrying the status so a caller can tell "your
 * credential is no good" (401/403) from "content is down" (5xx) and say
 * something different about each.
 */
export class ContentHostError extends Error {
  readonly statusCode: number;
  /**
   * Whatever was in `details`, unread.
   *
   * The publish routes put a `PublishProblem[]` there - every problem with a
   * declaration rather than the first - and the older routes put a sentence.
   * Keeping it unparsed here lets each caller read the one it expects without
   * this file having to know about either.
   */
  readonly details: unknown;
  /**
   * The whole answer.
   *
   * Some refusals carry a field of their own beside the message - a stale
   * pointer answers with the `head` the branch is at now, which is the one
   * thing that tells a publisher what happened - so the body is kept rather
   * than reduced to two strings on the way past.
   */
  readonly body: unknown;
  constructor(
    statusCode: number,
    message: string,
    details?: unknown,
    body?: unknown,
  ) {
    super(message);
    this.name = "ContentHostError";
    this.statusCode = statusCode;
    this.details = details;
    this.body = body;
  }
}

/** The `details` of a refusal, when it is a sentence rather than a list. */
export function detailText(details: unknown): string | null {
  return typeof details === "string" && details !== "" ? details : null;
}

/** GET JSON from content. Same envelope, same failures, one less body. */
export async function getJson(options: {
  url: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return requestJson({ method: "GET", ...options });
}

/**
 * POST JSON to content and read JSON back.
 *
 * Content answers an error as `{ statusCode, message, details? }` (its
 * `sendResult`), so the message a user sees is the one the service wrote
 * rather than a status code they then have to look up. A body that is not
 * that shape - a proxy's HTML error page, say - still has to produce a
 * sentence, hence the fallback.
 */
export async function postJson(options: {
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  return requestJson({ method: "POST", ...options });
}

async function requestJson(options: {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(options.url, {
      method: options.method,
      headers:
        options.method === "GET"
          ? options.headers
          : { "Content-Type": "application/json", ...options.headers },
      ...(options.method === "GET"
        ? {}
        : { body: JSON.stringify(options.body ?? {}) }),
    });
  } catch (err) {
    // No status at all: DNS, TLS, a dropped connection. 0 is the shape the
    // rest of this file expects, and it is never a status a server sends.
    throw new ContentHostError(
      0,
      `Could not reach ${options.url}`,
      err instanceof Error ? err.message : String(err),
    );
  }
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text !== "") {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }
  if (!res.ok) {
    throw new ContentHostError(
      res.status,
      errorMessageOf(parsed) ?? `${res.status} ${res.statusText}`,
      errorDetailsOf(parsed),
      parsed,
    );
  }
  return parsed;
}

function errorMessageOf(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = body.message;
    if (typeof message === "string" && message !== "") {
      return message;
    }
  }
  return undefined;
}

function errorDetailsOf(body: unknown): unknown {
  if (typeof body === "object" && body !== null && "details" in body) {
    return body.details;
  }
  return undefined;
}
