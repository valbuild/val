import {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
  Internal,
} from "@valbuild/core";
import { traverseSchemaAt } from "./traverseSchemas";
import { sourcePathOfChild } from "../utils/sourcePath";
import {
  forEachRichTextImage,
  richTextImageSchema,
} from "../utils/richTextImages";
import { galleryKeyOf } from "../utils/galleryKey";

/** A field pointing into a gallery, and what it holds there. */
export type FileReferrer = {
  sourcePath: SourcePath;
  /** The field's `path`, or `null` for an empty field. */
  path: string | null;
  /** Whether the value carries a draft `patch_id`. */
  hasPatchId: boolean;
};

/**
 * Every media field pointing into the gallery `parent` — gallery-backed
 * `s.image()` / `s.file()` fields, set-backed `s.video()` fields, and the inline images of a rich text field
 * whose `img` schema is gallery-backed.
 */
export function getFileReferrers(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, only the referrers naming this entry
): FileReferrer[] {
  const results: FileReferrer[] = [];
  const seen = new Set<SourcePath>();
  const galleryKeys = fileRef === undefined ? null : keysOf(sources[parent]);
  const add = (sourcePath: SourcePath, source: unknown) => {
    const media = mediaValueOf(source);
    if (galleryKeys !== null) {
      if (media === null || galleryKeyOf(media.path, galleryKeys) !== fileRef) {
        return;
      }
    }
    if (seen.has(sourcePath)) {
      return;
    }
    seen.add(sourcePath);
    results.push({
      sourcePath,
      path: media?.path ?? null,
      hasPatchId: media?.hasPatchId ?? false,
    });
  };
  // Only the modules whose schema can point into the gallery: the walk is of
  // their SOURCE, and a library of 10,000 entries that cannot refer to this
  // one is 10,000 entries walked for nothing, on every scan.
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!canReferTo(schema, parent)) continue;
    const source = sources[moduleFilePath];
    const root = moduleFilePathS as SourcePath;
    if (schema.type !== "record" || !isRecordSource(source)) {
      for (const hit of hitsIn(root, schema, source, parent, false)) {
        add(hit.sourcePath, hit.source);
      }
      continue;
    }
    // A record, entry by entry, and an entry that is the same object as
    // last time keeps what was found in it: a scan while a `.jsonValues()`
    // record of 10,000 loads walks the entries that arrived, not the record.
    const mediaEntry = schema.mediaType !== undefined;
    for (const key in source) {
      if (key === "patch_id") continue;
      const value = source[key];
      if (value === undefined) continue;
      for (const hit of entryHits(
        root,
        key,
        schema,
        value,
        parent,
        mediaEntry,
      )) {
        add(hit.sourcePath, hit.source);
      }
    }
  }
  return results;
}

export function getReferencedFiles(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, filter to only paths whose source names fileRef
): SourcePath[] {
  return getFileReferrers(schemas, sources, parent, fileRef).map(
    (referrer) => referrer.sourcePath,
  );
}

/** A media value found pointing into a gallery, before it is filtered. */
type Hit = { sourcePath: SourcePath; source: unknown };

/**
 * Per record schema, per entry VALUE, per gallery and path: what that entry
 * holds pointing into the gallery. By identity, which the Studio's sources
 * keep for an entry nothing touched; an equal value that is a new object is
 * walked again.
 */
const hitsByEntry = new WeakMap<
  SerializedSchema,
  WeakMap<object, Map<string, Hit[]>>
>();

function entryHits(
  root: SourcePath,
  key: string,
  record: Extract<SerializedSchema, { type: "record" }>,
  value: Source,
  parent: ModuleFilePath,
  mediaEntry: boolean,
): Hit[] {
  if (typeof value !== "object" || value === null) {
    return hitsIn(
      sourcePathOfChild(root, key),
      record.item,
      value,
      parent,
      mediaEntry,
    );
  }
  let byValue = hitsByEntry.get(record);
  if (byValue === undefined) {
    byValue = new WeakMap();
    hitsByEntry.set(record, byValue);
  }
  let found = byValue.get(value);
  if (found === undefined) {
    found = new Map();
    byValue.set(value, found);
  }
  // The path is made only when the entry is walked: on a scan that finds
  // the entry as it was, building one per entry was most of the scan.
  const cacheKey = `${parent}\0${root}\0${key}`;
  let hits = found.get(cacheKey);
  if (hits === undefined) {
    hits = hitsIn(
      sourcePathOfChild(root, key),
      record.item,
      value,
      parent,
      mediaEntry,
    );
    found.set(cacheKey, hits);
  }
  return hits;
}

/** Every media value under `at` that points into `parent`. */
function hitsIn(
  at: SourcePath,
  schema: SerializedSchema | undefined,
  source: Source,
  parent: ModuleFilePath,
  mediaEntry: boolean,
): Hit[] {
  const hits: Hit[] = [];
  const add = (sourcePath: SourcePath, source: unknown) => {
    hits.push({ sourcePath, source });
  };
  traverseSchemaAt(
    at,
    schema,
    source,
    (sourcePath, schema, source) => {
      if (
        schema.type === "image" ||
        schema.type === "file" ||
        schema.type === "video"
      ) {
        if (schema.referencedModule === parent) {
          add(sourcePath, source);
        }
      } else if (schema.type === "richtext") {
        const img = richTextImageSchema(schema);
        if (img?.referencedModule === parent) {
          forEachRichTextImage(sourcePath, source, add);
        }
      } else if (
        schema.type === "string" ||
        schema.type === "number" ||
        schema.type === "boolean" ||
        schema.type === "literal" ||
        schema.type === "enum" ||
        schema.type === "date" ||
        schema.type === "dateTime" ||
        schema.type === "color" ||
        schema.type === "code" ||
        schema.type === "keyOf" ||
        schema.type === "route" ||
        schema.type === "locale" ||
        // A view holds no source, so it references no file of its own.
        schema.type === "view"
      ) {
        // ignore these
      } else {
        const exhaustiveCheck: never = schema;
        Internal.log.error(
          `Could not get referenced files. Unhandled schema type`,
          exhaustiveCheck,
        );
      }
    },
    mediaEntry,
  );
  return hits;
}

function isRecordSource(
  source: Source,
): source is Source & { readonly [key: string]: Source | undefined } {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}

/** Per schema object: the galleries something in it can pick from. */
const galleriesOf = new WeakMap<SerializedSchema, ReadonlySet<string>>();

/**
 * Whether anything in `schema` names `gallery` as its `referencedModule`: a
 * gallery-backed media field, or a rich text whose images are. Read from the
 * serialized schema as data, so a new kind of field that picks from a
 * gallery is found without being listed here.
 */
function canReferTo(
  schema: SerializedSchema,
  gallery: ModuleFilePath,
): boolean {
  let galleries = galleriesOf.get(schema);
  if (galleries === undefined) {
    const found = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      for (const [key, value] of Object.entries(node)) {
        if (key === "referencedModule" && typeof value === "string") {
          found.add(value);
        } else {
          walk(value);
        }
      }
    };
    walk(schema);
    galleries = found;
    galleriesOf.set(schema, galleries);
  }
  return galleries.has(gallery);
}

function mediaValueOf(
  source: unknown,
): { path: string; hasPatchId: boolean } | null {
  if (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    "path" in source &&
    typeof source.path === "string"
  ) {
    return {
      path: source.path,
      hasPatchId: "patch_id" in source && typeof source.patch_id === "string",
    };
  }
  return null;
}

/** Per gallery source object: its entry keys. */
const galleryKeysOf = new WeakMap<object, ReadonlySet<string>>();

/** The gallery's entry keys, or none when its source is not an object yet. */
function keysOf(source: Source | undefined): ReadonlySet<string> {
  if (typeof source === "object" && source !== null && !Array.isArray(source)) {
    let keys = galleryKeysOf.get(source);
    if (keys === undefined) {
      keys = new Set(Object.keys(source));
      galleryKeysOf.set(source, keys);
    }
    return keys;
  }
  return new Set();
}
