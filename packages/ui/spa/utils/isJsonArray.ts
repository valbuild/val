import { JsonArray, JsonObject } from "@valbuild/core";

export function isJsonArray(
  source: JsonArray | JsonObject,
): source is JsonArray {
  return Array.isArray(source);
}
