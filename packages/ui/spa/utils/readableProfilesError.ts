/**
 * What went wrong, in the words the server used.
 *
 * The server wraps its own failure in a message of its own — `Profiles failed:
 * 404 {"statusCode":404,"message":"Project not found"}` — and the useful half
 * is the inner one. "Project not found" is something an editor can act on; the
 * outer string is a status line with the answer buried in it.
 *
 * Everything is optional on the way in, because this is an error body: the one
 * case it must handle is the server not answering in the shape it promised.
 */
export function readableProfilesError(json: unknown): string {
  const fallback = "Could not load profiles";
  const message = readMessage(json);
  if (message === undefined) return fallback;
  const jsonStart = message.indexOf("{");
  if (jsonStart === -1) return message;
  let inner: unknown;
  try {
    inner = JSON.parse(message.slice(jsonStart));
  } catch {
    // A brace, but not JSON after it — the whole message is what we have.
    return message;
  }
  return readMessage(inner) ?? message;
}

function readMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("message" in value)) return undefined;
  const message: unknown = value.message;
  return typeof message === "string" ? message : undefined;
}
