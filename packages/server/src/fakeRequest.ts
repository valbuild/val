/**
 * A stand-in `Request` for router tests.
 *
 * Shared rather than copied, because the copies drifted from a real `Request`
 * in the same way and it cost a red CI run. `ValRouter` tells "no body" from
 * "a malformed body" by reading the body as TEXT — a real `Request` throws on
 * `json()` when there is none — so a fake implementing only `json()` cannot
 * express the difference, and every route with an optional body looked fine
 * here while answering 400 in the browser.
 */
export function fakeRequest({
  url,
  method,
  headers,
  json,
}: {
  method: string;
  url: URL;
  headers?: Headers;
  json?: unknown;
}): Request {
  const body = json === undefined ? "" : JSON.stringify(json);
  return {
    method,
    url,
    headers: headers ?? new Headers(),
    json: async () => json,
    text: async () => body,
  } as unknown as Request;
}
