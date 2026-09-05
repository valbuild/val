import {
  SerializedSchema,
  Json,
  Internal,
  DEFAULT_COLOR_FORMAT,
  acceptedLocaleValues,
  declaredKeySetOf,
} from "@valbuild/core";

/**
 * Local `yyyy-MM-dd`, which is the one thing this module used `date-fns` for.
 *
 * Inlined rather than carried along: `@valbuild/shared` depends on nothing but
 * `@valbuild/core` and zod, and a whole date library is not worth adding to
 * that for a single format string. Deliberately the *local* date, not
 * `toISOString().slice(0, 10)` — the latter is UTC, so anyone west of
 * Greenwich would get yesterday's date as their "today" default.
 */
function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

/**
 * What `emptyOf` cannot read off a serialized schema.
 *
 * Only the project's languages, so far. A locale-keyed record has one entry per
 * language and the languages are declared in the settings module — another file
 * — so an empty one cannot be built without being told. Optional throughout:
 * a caller that has no context gets an empty record, which validation then
 * reports, rather than a wrong one.
 */
export type EmptyOfContext = {
  /** `locales.available` from the settings module. */
  locales?: string[];
};

export function emptyOf(
  schema: SerializedSchema,
  context?: EmptyOfContext,
): Json {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.keys(schema.items).map((key) => [
        key,
        emptyOf(schema.items[key], context),
      ]),
    );
  } else if (schema.type === "array") {
    return [];
  } else if (schema.type === "record") {
    return emptyRecord(schema, context);
  } else if (schema.type === "settings") {
    // Not an object of empty sections: every settings key is optional, and
    // absent IS the empty value. Filling the sections in would write a shape
    // the project never asked for.
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
  } else if (schema.type === "locale") {
    // Which languages exist is in the settings module, which `emptyOf` has no
    // access to — it works from a serialized schema alone. The empty string is
    // not one of them, so validation reports it, which is the honest outcome:
    // the Studio's add paths choose a real language, and a caller that has not
    // been given one has not been given one.
    return "";
  } else if (schema.type === "file" || schema.type === "image") {
    return null; // returning null is the only thing we can do, however, it means that the patches cannot be applied yet since that might fail
  } else if (schema.type === "literal") {
    return schema.value;
  } else if (schema.type === "union") {
    if (typeof schema.key === "string") {
      return emptyOf(schema.items[0], context);
    }
    return schema.key.value;
  } else if (schema.type === "date") {
    return clampDateString(formatLocalDate(new Date()), schema.options);
  } else if (schema.type === "dateTime") {
    return clampDateTimeString(new Date().toISOString(), schema.options);
  } else if (schema.type === "color") {
    // Mid grey: visible against both a light and a dark canvas
    return Internal.color.formatColor(
      { r: 128, g: 128, b: 128, a: 1 },
      schema.options?.format ?? DEFAULT_COLOR_FORMAT,
    );
  } else if (schema.type === "code") {
    return ""; // An empty editor: no language has a sensible starting snippet
  }
  const _exhaustiveCheck: never = schema;
  throw Error("Unexpected schema type: " + JSON.stringify(_exhaustiveCheck));
}

/**
 * An empty record — with every key its schema declares already in it.
 *
 * An open record (`s.record(s.string(), item)`) starts empty, because there is
 * no key anyone could mean. A record whose key schema enumerates its keys is
 * the opposite: the keys are part of the schema, so an empty one is already
 * missing them, and handing back `{}` would create content that fails
 * validation the moment it is written.
 *
 * The entries are `null` rather than `emptyOf(item)`. A null entry reads as "not
 * filled in yet", which is what a language nobody has translated into IS —
 * whereas an entry of empty strings claims someone wrote it and left it blank,
 * and would count as translated in every list and filter downstream.
 */
function emptyRecord(
  schema: SerializedSchema & { type: "record" },
  context: EmptyOfContext | undefined,
): Json {
  const declared = declaredKeySetOf(schema.key);
  if (declared === null) {
    return {};
  }
  const keys =
    declared.kind === "literals"
      ? declared.keys
      : acceptedLocaleValues(context?.locales ?? [], declared.aliases);
  return Object.fromEntries(keys.map((key) => [key, null]));
}
