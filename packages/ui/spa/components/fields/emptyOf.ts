import { SerializedSchema, Json } from "@valbuild/core";
import { format } from "date-fns";

function clampDateString(
  value: string,
  options: { from?: string; to?: string } | undefined,
): string {
  if (options?.to && value > options.to) return options.to;
  if (options?.from && value < options.from) return options.from;
  return value;
}

function clampDateTimeString(
  value: string,
  options: { from?: string; to?: string } | undefined,
): string {
  if (!options) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  // Stored datetime values are always UTC ISO strings, so normalize the
  // clamped bound (which may carry a timezone offset) via toISOString().
  if (options.to) {
    const toMs = Date.parse(options.to);
    if (!Number.isNaN(toMs) && ms > toMs) return new Date(toMs).toISOString();
  }
  if (options.from) {
    const fromMs = Date.parse(options.from);
    if (!Number.isNaN(fromMs) && ms < fromMs)
      return new Date(fromMs).toISOString();
  }
  return value;
}

export function emptyOf(schema: SerializedSchema): Json {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.keys(schema.items).map((key) => [key, emptyOf(schema.items[key])]),
    );
  } else if (schema.type === "array") {
    return [];
  } else if (schema.type === "record") {
    return {};
  } else if (schema.opt) {
    return null;
  } else if (schema.type === "richtext") {
    return [];
  } else if (schema.type === "string") {
    return "";
  } else if (schema.type === "boolean") {
    return false;
  } else if (schema.type === "number") {
    return 0;
  } else if (schema.type === "keyOf") {
    if (schema.values === "string") {
      return ""; // TODO: figure out this: user code might very well fail in this case
    } else {
      return schema.values[0];
    }
  } else if (schema.type === "route") {
    return ""; // Empty string as default route value
  } else if (schema.type === "file" || schema.type === "image") {
    return null; // returning null is the only thing we can do, however, it means that the patches cannot be applied yet since that might fail
  } else if (schema.type === "literal") {
    return schema.value;
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      return emptyOf(schema.items[0]);
    }
    return schema.key.value;
  } else if (schema.type === "date") {
    return clampDateString(format(new Date(), "yyyy-MM-dd"), schema.options);
  } else if (schema.type === "dateTime") {
    return clampDateTimeString(new Date().toISOString(), schema.options);
  }
  const _exhaustiveCheck: never = schema;
  throw Error("Unexpected schema type: " + JSON.stringify(_exhaustiveCheck));
}
