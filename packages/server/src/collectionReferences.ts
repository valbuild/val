/**
 * The fields that name an entry of a media collection by its key, and the
 * patches that point them at a new key.
 *
 * A collection — `s.imageset()`, `s.fileset()`, `s.videoset()` — is a record
 * keyed by each entry's file path, and a field picked from it
 * (`s.image(imagesVal)`, `s.file(filesVal)`, `s.video(videosVal)`) stores that
 * key as its `path`. So when `--fix` renames a key — moving an entry of a
 * `.remote()` collection to Val Remote renames it from the local path to the
 * ref — every field holding the old key would name an entry the collection no
 * longer has, and nothing could repair it afterwards.
 *
 * Two kinds of value name a key:
 *
 * - **A field whose schema is backed by the collection** (`referencedModule`).
 * - **An inline image in rich text** whose `img` schema is backed by it
 *   (`s.richtext({ img: s.image(imagesVal) })`). The field's own schema is
 *   `richtext`, so a walk looking only for image leaves goes straight past
 *   them — the Studio's reference scan learned that once already
 *   (`getReferencedFiles`), and uses the same `forEachRichTextImage`.
 *
 * **A field is renamed when the key it names is the old key**, and "names" is
 * `galleryKeyOf` in core: the field's `path` when that is a key, and otherwise
 * the local path inside it when it is a ref. That is how a field is read
 * (`fillFromGallery`) and how it is validated, so it is exactly the set of
 * fields the rename would break. The second shape is real: an image uploaded
 * THROUGH an `s.image(remoteGallery)` field in the Studio stores the ref in
 * the field and keys the entry by the local path inside it, so uploading that
 * entry here has to move the field to the entry's new key as well. A ref that
 * is itself a key names its own entry, and is left alone.
 *
 * Nothing here imports `fixHandlers.ts` at runtime: that module calls this one.
 */
import {
  Internal,
  type ModuleFilePath,
  type ModulePath,
  type SourcePath,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import {
  forEachRichTextImage,
  richTextImageSchema,
  traverseSchemaSource,
} from "@valbuild/shared/internal";
import type { ModulePatch } from "./fixHandlers";
import type { Service } from "./Service";

/** What of a `Service` the project-wide walk needs. */
export type CollectionReferenceService = Pick<
  Service,
  "getModuleFilePaths" | "get"
>;

/** A value that names an entry of a collection by its key. */
export type CollectionReference = {
  moduleFilePath: ModuleFilePath;
  /** The media value's own path: a field, or a rich text image's `src`. */
  sourcePath: SourcePath;
  /** The key it names. */
  path: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a serialized schema is backed by `collection` anywhere in it. */
function isBackedBy(schema: unknown, collection: ModuleFilePath): boolean {
  if (Array.isArray(schema)) {
    return schema.some((item) => isBackedBy(item, collection));
  }
  if (!isRecord(schema)) {
    return false;
  }
  if (schema.referencedModule === collection) {
    return true;
  }
  return Object.values(schema).some((value) => isBackedBy(value, collection));
}

/**
 * Every value in the project that names an entry of `collection`.
 *
 * Validated reads for the modules backed by it, because only those come back
 * with their `.jsonValues()` entries loaded — an unvalidated read hands back
 * each entry as a marker, and a field inside one would be invisible. Every
 * other module is read once, unvalidated, to find out it is not one of them.
 */
export async function collectionReferencesOf(
  service: CollectionReferenceService,
  collection: ModuleFilePath,
): Promise<CollectionReference[]> {
  const found: CollectionReference[] = [];
  for (const moduleFilePath of service.getModuleFilePaths()) {
    const shallow = await service.get(moduleFilePath, "" as ModulePath, {
      validate: false,
    });
    if (!isBackedBy(shallow.schema, collection)) {
      continue;
    }
    const loaded = await service.get(moduleFilePath, "" as ModulePath, {
      validate: true,
    });
    if (loaded.source === undefined || !loaded.schema) {
      continue;
    }
    const add = (sourcePath: SourcePath, value: unknown) => {
      if (isRecord(value) && typeof value.path === "string") {
        found.push({ moduleFilePath, sourcePath, path: value.path });
      }
    };
    traverseSchemaSource(
      loaded.source,
      loaded.schema,
      moduleFilePath as string as SourcePath,
      ({ source, schema, path: sourcePath }) => {
        if (
          schema.type === "image" ||
          schema.type === "file" ||
          schema.type === "video"
        ) {
          if (schema.referencedModule === collection) {
            add(sourcePath, source);
          }
        } else if (schema.type === "richtext") {
          if (richTextImageSchema(schema)?.referencedModule === collection) {
            forEachRichTextImage(sourcePath, source, add);
          }
        }
      },
    );
  }
  return found;
}

/**
 * The patch path of `sourcePath`. Not `sourceToPatchPath`: a collection's keys
 * are file paths, and their dots do not survive its `split(".")`.
 */
function patchPathOf(sourcePath: SourcePath): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  return Internal.splitModulePath(modulePath);
}

/**
 * The patches that point every value naming a key in `renamed` at its new key.
 *
 * `renamed` is keyed by the collection's keys BEFORE the rename, and the
 * collection is read as it is now — so call this before its own patch lands.
 *
 * One `add` on each value's `path`, so the alt text, hotspot, poster and
 * captions beside it are never rewritten.
 */
export async function collectionReferencePatches(
  service: CollectionReferenceService,
  collection: ModuleFilePath,
  renamed: Record<string, string>,
): Promise<ModulePatch[]> {
  const collectionSource = (
    await service.get(collection, "" as ModulePath, { validate: false })
  ).source;
  const keys = new Set(
    isRecord(collectionSource) ? Object.keys(collectionSource) : [],
  );
  const byModule = new Map<ModuleFilePath, Patch>();
  for (const reference of await collectionReferencesOf(service, collection)) {
    const key = Internal.media.galleryKeyOf(reference.path, (candidate) =>
      keys.has(candidate),
    );
    if (key === null || !Object.prototype.hasOwnProperty.call(renamed, key)) {
      continue;
    }
    const patch = byModule.get(reference.moduleFilePath) ?? [];
    patch.push({
      op: "add",
      path: patchPathOf(reference.sourcePath).concat("path"),
      value: renamed[key],
    });
    byModule.set(reference.moduleFilePath, patch);
  }
  return [...byModule].map(([moduleFilePath, patch]) => ({
    moduleFilePath,
    patch,
  }));
}
