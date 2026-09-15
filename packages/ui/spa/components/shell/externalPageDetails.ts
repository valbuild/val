import {
  Internal,
  SerializedSchema,
  Source,
  SourcePath,
  ModuleFilePath,
} from "@valbuild/core";
import { flattenRichText } from "@valbuild/shared/internal";
import { sourcePathOfChild } from "../../utils/sourcePath";
import { prettifyFilename } from "../../utils/prettifyFilename";
import {
  ShellExternalPage,
  ShellExternalPageField,
  ShellExternalPageUsage,
} from "./types";

/**
 * Turning the external router's record into the rows the dialog shows.
 *
 * Two things have to be derived per URL, and neither is in the record's keys:
 * what the entry HOLDS, and where the site links to it. Both are pure functions
 * of data the Studio already has, which is why they live here rather than in
 * the hook - the hook's job is only to decide when to ask.
 */

/** How much of a value is worth putting on one line of a detail pane. */
const MAX_VALUE_LENGTH = 200;

/**
 * The entry's own fields, flattened for reading.
 *
 * Only the top level: an external page's entry is a title and maybe an icon,
 * and a detail pane that unfolds a whole tree stops being a summary. Anything
 * deeper is summarised by shape ("3 items") rather than expanded, because the
 * row's real answer to "what is in here" is Open in editor.
 *
 * `undefined` rather than `[]` when the entry is not loaded — an unfetched
 * `.jsonValues()` entry is an opaque marker, and an empty field list would
 * read as "this entry has nothing in it".
 */
export function toExternalPageFields(
  itemSchema: SerializedSchema | undefined,
  entry: Source | undefined,
  entryPath: SourcePath,
): ShellExternalPageField[] | undefined {
  if (itemSchema === undefined || entry === undefined) {
    return undefined;
  }
  if (Internal.isJson(entry)) {
    return undefined;
  }
  if (itemSchema.type === "object" || itemSchema.type === "settings") {
    const fields = asFields(entry);
    if (fields === null) {
      return [];
    }
    return Object.entries(itemSchema.items).map(
      ([key, fieldSchema]): ShellExternalPageField => ({
        label: key,
        value: describeSourceValue(fieldSchema, fields.get(key) ?? null),
        sourcePath: sourcePathOfChild(entryPath, key),
      }),
    );
  }
  // A router whose item is a single value — `s.string()`, a richtext, an
  // image. One field, named for what it is rather than for a key it has not
  // got.
  return [
    {
      label: itemSchema.type,
      value: describeSourceValue(itemSchema, entry),
      sourcePath: entryPath,
    },
  ];
}

/**
 * One line of text for a value, chosen by its SCHEMA rather than by its shape.
 *
 * The schema is what tells a `{ path, width, height }` from an ordinary object
 * and a richtext array from a list — guessing from the value gets both wrong,
 * and gets them wrong in the direction of printing JSON at a person.
 */
export function describeSourceValue(
  schema: SerializedSchema | undefined,
  value: Source,
): string {
  return truncate(describe(schema, value));
}

function describe(schema: SerializedSchema | undefined, value: Source): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Internal.isJson(value)) {
    return "…";
  }
  if (schema === undefined) {
    return typeof value === "object" ? "…" : String(value);
  }
  switch (schema.type) {
    case "string":
    case "literal":
    case "enum":
    case "date":
    case "dateTime":
    case "color":
    case "code":
    case "route":
    case "keyOf":
    case "locale":
      return typeof value === "string" ? value : String(value);
    case "number":
    case "boolean":
      return String(value);
    case "richtext":
      return flattenRichText(value).trim();
    case "image":
    case "file": {
      const path = asFields(value)?.get("path");
      return typeof path === "string" ? path : "";
    }
    case "array":
      return Array.isArray(value)
        ? `${value.length} item${value.length === 1 ? "" : "s"}`
        : "";
    case "record": {
      const entries = asFields(value);
      if (entries === null) return "";
      return `${entries.size} entr${entries.size === 1 ? "y" : "ies"}`;
    }
    case "object":
    case "settings": {
      const fields = asFields(value);
      if (fields === null) return "";
      return `${fields.size} field${fields.size === 1 ? "" : "s"}`;
    }
    case "discriminated-union": {
      // The tag is the useful half: "video" says more about a block than
      // "4 fields" does.
      const tag = asFields(value)?.get(schema.key);
      return typeof tag === "string" ? tag : "";
    }
    default: {
      const exhaustiveCheck: never = schema;
      void exhaustiveCheck;
      return "";
    }
  }
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_VALUE_LENGTH
    ? `${collapsed.slice(0, MAX_VALUE_LENGTH - 1)}…`
    : collapsed;
}

/**
 * The value's fields, or null when it has none to speak of.
 *
 * A `Map` rather than a narrowed object, and that is not fussiness. The
 * `Source` union's object-shaped members are `SourceObject`, `MediaSource`,
 * `SettingsSource`, the `.jsonValues()` marker and the `c.external()` marker;
 * `Array.isArray` cannot narrow a `readonly Source[]` out of a union, and the
 * media and settings shapes are not assignable to a string index signature
 * because of their optional fields. So there is no narrowing that yields
 * something indexable by an arbitrary key - which is exactly what this needs,
 * for an object schema's keys and a union's discriminant. The codebase's other
 * walkers reach for `as Record<string, Source>` here; building the map instead
 * costs one pass over an object that has a handful of keys.
 */
function asFields(value: Source | undefined): Map<string, Source> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if (Internal.isJson(value) || Internal.isExternal(value)) {
    return null;
  }
  const fields = new Map<string, Source>();
  for (const key of Object.keys(value)) {
    const child: unknown = Reflect.get(value, key);
    fields.set(key, isSource(child) ? child : null);
  }
  return fields;
}

/**
 * Everything a module's source can hold is `Source` by construction, so this is
 * a shape check standing in for a cast rather than a real question: it exists
 * so `Reflect.get`'s `unknown` becomes `Source` by a check instead of by an
 * assertion. Objects and arrays are accepted whole - their children go through
 * the same check when they are read.
 */
function isSource(value: unknown): value is Source {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "object"
  );
}

/**
 * Where a URL is linked from, as a person would name the place.
 *
 * The module's file name, then the path to the field: "Footer / social / 0 /
 * url". Not `ValPath`, which measures text to fit a width and is a component —
 * this is a string, going into a list where every row is the same size.
 */
export function toExternalPageUsages(
  refs: readonly SourcePath[],
): ShellExternalPageUsage[] {
  return refs.map((sourcePath): ShellExternalPageUsage => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const segments =
      modulePath === "" ? [] : Internal.splitModulePath(modulePath);
    const fileName = moduleFilePath.split("/").pop() ?? moduleFilePath;
    return {
      sourcePath,
      label: [prettifyFilename(fileName), ...segments].join(" / "),
      moduleFilePath,
    };
  });
}

/**
 * The record's item schema, where the module is the external router.
 *
 * Absent for anything else, including a record that is not a router: the
 * dialog is only ever pointed at the external module, but the schema store
 * answers for every module and this is where that assumption is checked.
 */
export function externalItemSchema(
  schema: SerializedSchema | undefined,
): SerializedSchema | undefined {
  return schema?.type === "record" ? schema.item : undefined;
}

/** Everything the dialog needs about one URL, from what the Studio has. */
export function enrichExternalPages(
  pages: readonly ShellExternalPage[],
  moduleFilePath: ModuleFilePath | undefined,
  itemSchema: SerializedSchema | undefined,
  moduleSource: Source | undefined,
  referencesTo: (url: string) => SourcePath[],
  usagesComplete: boolean,
): ShellExternalPage[] {
  const entries = moduleFilePath === undefined ? null : asFields(moduleSource);
  return pages.map((page): ShellExternalPage => {
    // Built from the module and the key rather than taken from the row, so
    // nothing has to assert a `string` back into a `SourcePath`. The record's
    // keys ARE the URLs, which is what makes that possible here.
    const entryPath =
      moduleFilePath === undefined
        ? undefined
        : sourcePathOfChild(moduleFilePath, page.url);
    return {
      ...page,
      fields:
        entryPath === undefined
          ? undefined
          : toExternalPageFields(
              itemSchema,
              entries?.get(page.url) ?? undefined,
              entryPath,
            ),
      usages: toExternalPageUsages(referencesTo(page.url)),
      usagesComplete,
    };
  });
}
