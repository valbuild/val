/**
 * How long an appended `details` may be before it is cut.
 *
 * A thrown DAL error in the content service quotes the whole offending ROW back
 * — which for a patch is every op the editor just made — so an uncapped append
 * puts kilobytes of JSON in a dialog. The head is where the cause is; the tail
 * is the evidence, and it belongs in the service's own logs.
 */
const MAX_DETAILS_LENGTH = 500;

export function getErrorMessageFromUnknownJson(
  json: unknown,
  fallback: string,
): string {
  if (
    typeof json === "object" &&
    json !== null &&
    "message" in json &&
    typeof json.message === "string"
  ) {
    const details = detailsOf(json);
    if (details === null || details === json.message) {
      return json.message;
    }
    return `${json.message}: ${details}`;
  }
  return fallback;
}

/**
 * The cause the content service put beside its message, when it wrote one a
 * person can read.
 *
 * `HttpError` in `home` is `{ statusCode, message?, details? }`, and `details`
 * is filled in two quite different ways. Where a handler REFUSED, it holds the
 * structured zod error whose summary is already the `message` — repeating it
 * adds nothing. Where a handler THREW, `sendResult` writes `message:
 * "Internal Server Error"` and puts the exception's own message in `details` —
 * so there the message says nothing and the details say everything.
 *
 * Which is why the test is the TYPE rather than the status code: a string
 * `details` is prose meant to be read, an object is a payload meant to be
 * parsed. This takes the first and leaves the second.
 *
 * It was written after an hour was lost to the second case. A patch save
 * against a content service that threw showed the Studio exactly
 * `"Internal Server Error"` and nothing else, in a dialog with no other clue,
 * while the service's answer had been carrying the reason the whole time.
 */
function detailsOf(json: object): string | null {
  if (!("details" in json) || typeof json.details !== "string") {
    return null;
  }
  const details = json.details.trim();
  if (details === "") {
    return null;
  }
  if (details.length <= MAX_DETAILS_LENGTH) {
    return details;
  }
  return `${details.slice(0, MAX_DETAILS_LENGTH)}…`;
}

export const DEFAULT_ERROR_MESSAGE =
  "Unknown error with unknown message from server";
