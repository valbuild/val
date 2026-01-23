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
    return json.message;
  }
  return fallback;
}

export const DEFAULT_ERROR_MESSAGE =
  "Unknown error with unknown message from server";
