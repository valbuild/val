import { Json, SerializedSchema } from "@valbuild/core";
import { fixCapitalization } from "./fixCapitalization";
import { parseLocalDay } from "./localDay";
import { richTextToString } from "./richTextToString";

/**
 * The text of `InlineObjectPreview`: one object's values on one line. Kept out
 * of the component so it is a pure function of (schema, value).
 */
export type InlinePart = { label: string | null; text: string };

/** The non-empty values under `value`, each with the name of its own field. */
export function inlineParts(
  schema: SerializedSchema,
  value: Json,
  label: string | null,
): InlinePart[] {
  if (schema.type === "object" || schema.type === "settings") {
    if (!isPlainObject(value)) {
      return [];
    }
    return Object.entries(schema.items).flatMap(([key, item]) =>
      item.hidden
        ? []
        : inlineParts(item, value[key] ?? null, fixCapitalization(key)),
    );
  }
  if (schema.type === "discriminated-union") {
    if (!isPlainObject(value)) {
      return [];
    }
    const tag = value[schema.key];
    const variant = schema.items.find((item) => {
      const keySchema = item.items[schema.key];
      return keySchema?.type === "literal" && keySchema.value === tag;
    });
    return variant ? inlineParts(variant, value, label) : [];
  }
  const text = inlineText(schema, value);
  return text === null ? [] : [{ label, text }];
}

/** A single value as text, or `null` when there is nothing to show. */
function inlineText(schema: SerializedSchema, value: Json): string | null {
  if (value === null) {
    return null;
  }
  switch (schema.type) {
    case "string":
    case "literal":
    case "enum":
    case "keyOf":
    case "route":
    case "locale":
    case "color":
    case "code":
      return typeof value === "string" && value.trim() !== "" ? value : null;
    case "number":
      return typeof value === "number" ? String(value) : null;
    case "boolean":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : null;
    case "date": {
      if (typeof value !== "string") {
        return null;
      }
      const day = parseLocalDay(value);
      return day ? day.toLocaleDateString() : value;
    }
    case "dateTime":
      return typeof value === "string"
        ? new Date(value).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })
        : null;
    case "array":
      return Array.isArray(value) ? count(value.length) : null;
    case "record":
      return isPlainObject(value) ? count(Object.keys(value).length) : null;
    case "image":
    case "file":
    case "video":
      return isPlainObject(value) && typeof value.path === "string"
        ? fileName(value.path)
        : null;
    case "richtext": {
      if (!Array.isArray(value)) {
        return null;
      }
      const asString = richTextToString(value);
      return asString.status === "ok" && asString.value.trim() !== ""
        ? asString.value
        : null;
    }
    case "object":
    case "settings":
    case "discriminated-union":
      // Walked by `inlineParts`; only reached for a value of the wrong shape.
      return null;
    case "view":
      // A pointer to another module, with no value of its own to show.
      return null;
    default: {
      const exhaustiveCheck: never = schema;
      return exhaustiveCheck;
    }
  }
}

function count(n: number): string | null {
  return n === 0 ? null : `${n} item${n === 1 ? "" : "s"}`;
}

function fileName(path: string): string {
  const withoutQuery = path.split("?")[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1) || path;
}

function isPlainObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
