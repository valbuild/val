import {
  Internal,
  RecordSchema,
  type Schema,
  type SelectorSource,
} from "@valbuild/core";

/*
 * `.jsonValues()` records, as the readers meet them. Moved here from the
 * `routeFromVal.ts` of `@valbuild/next` and `@valbuild/tanstack`, which were
 * the same lines twice.
 */

/**
 * True when the module's schema is a `.jsonValues()` record/router — i.e. each
 * entry value is a lazily-loaded `c.json(() => import(...))` marker. Used by the
 * readers to load ONLY the entries they need instead of the whole record.
 */
export function isJsonValuesRecordSchema(schema: unknown): boolean {
  return (
    schema instanceof RecordSchema &&
    schema["executeSerialize"]().jsonValues === true
  );
}

/**
 * The bundle's import of one `.jsonValues()` entry: `undefined` when the
 * module's own source has no marker for `key` to import from.
 */
export function bundledJsonEntryImport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any,
  key: string,
): (() => Promise<{ default: unknown }>) | undefined {
  const source = module && Internal.getSource(module);
  const marker =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? Object.prototype.hasOwnProperty.call(source, key)
        ? (source as Record<string, unknown>)[key]
        : undefined
      : undefined;
  if (!Internal.isJson(marker)) {
    return undefined;
  }
  return Internal.getJsonImport(marker) ?? undefined;
}

/**
 * Builds the `stegaEncode` `root` seed for a single `.jsonValues()` entry, so its
 * strings get edit tags. Without a seed, `stegaEncode` on raw entry content is an
 * identity transform (the content carries no selector path/schema).
 *
 * Yields e.g. `/src/routes/support.$slug.val.ts?p="/support/faq"`, so a `title`
 * field is tagged `…?p="/support/faq"."title"` — the shape the Studio's
 * `findUnloadedJsonEntryKey` walks, so click-to-edit + lazy load line up.
 */
export function getJsonEntryStegaRoot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selector: any,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { path: any; schema: any; instance: Schema<SelectorSource> } | undefined {
  const modulePath = selector && Internal.getValPath(selector);
  if (!modulePath) {
    return undefined;
  }
  const schema = selector && Internal.getSchema(selector);
  if (!(schema instanceof RecordSchema)) {
    return undefined;
  }
  const path = Internal.createValPathOfItem(modulePath, key);
  if (!path) {
    return undefined;
  }
  return {
    path,
    schema: schema["executeSerialize"]().item,
    // Where a `.component()` of the entry's objects lives: see `stegaEncode`.
    instance: schema["item"],
  };
}
