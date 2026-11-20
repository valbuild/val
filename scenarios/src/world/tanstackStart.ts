/**
 * TanStack Start's request context, as `@tanstack/react-start/server` gives it
 * to a server function or a loader: the request being served, its headers and
 * its cookies.
 *
 * This is the framework's, not Val's, so standing in for it is standing in for
 * the environment. Val's readers (`initValContent`) read draft state and the
 * session through it, and the world sets the request for the duration of one
 * page read (see `Page.read`).
 *
 * A scenario test installs it with:
 *
 *   jest.mock("@tanstack/react-start/server",
 *     () => jest.requireActual("./world/tanstackStart"), { virtual: true });
 *
 * (`virtual` because jest cannot resolve the real package: its `exports` map
 * has only an `import` condition.)
 */

let current: Request | null = null;

/** Runs `fn` as if serving `request`. Requests do not nest. */
export async function inRequest<T>(
  request: Request,
  fn: () => Promise<T>,
): Promise<T> {
  if (current !== null) {
    throw new Error("A page read started inside another page read.");
  }
  current = request;
  try {
    return await fn();
  } finally {
    current = null;
  }
}

export function getRequest(): Request {
  if (current === null) {
    throw new Error("No request in scope");
  }
  return current;
}

/**
 * The request's headers, with `Host`: every request that arrives over HTTP
 * carries one, and Val's readers need it (`getHost` in `initValContent`), but
 * a `Request` built in a test has none -- `fetch` sets it on the way out, and
 * these never go out.
 */
export function getRequestHeaders(): Headers {
  const request = getRequest();
  const headers = new Headers(request.headers);
  if (!headers.has("host")) {
    headers.set("host", new URL(request.url).host);
  }
  return headers;
}

/**
 * A cookie's value, decoded as the framework decodes it (h3 parses the
 * header with `cookie-es`, which percent-decodes each value): Val's server
 * writes `val_session` with `encodeURIComponent`, and a signature routinely
 * holds `+` and `/`.
 */
export function getCookie(name: string): string | undefined {
  const header = getRequest().headers.get("cookie");
  if (header === null) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function setCookie(): void {
  // A page read never sets a cookie in these scenarios. Turning draft mode on
  // and off goes through `Page`'s own draft flag instead.
}
