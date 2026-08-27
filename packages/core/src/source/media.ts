import { splitRemoteRef } from "../remote/splitRemoteRef";
import type { SerializedFileSchema } from "../schema/file";
import type { SerializedImageSchema } from "../schema/image";

/**
 * Media — images and files — is a plain object carrying a `path`.
 *
 * There is no marker on the value: nothing may decide "this is an image" by
 * looking at it. The **schema** says so (`type === "image" | "file"`), which is
 * what lets the same object be written in a `.val.ts` and in a `*.val.json`
 * entry, where a function call cannot be written at all.
 *
 * `path` is a plain `string` rather than a `` `/public/${string}` `` template so
 * a field can move between local and remote without a type error. Remote-ness
 * is read off the path: anything not under `/public` is remote.
 */
export type MediaHotspot = {
  x: number;
  y: number;
};

/**
 * The authored fields of a gallery-backed image (`s.image(galleryModule)`):
 * `width`/`height`/`mimeType` live in the gallery, so they are not repeated
 * here. One place per fact.
 */
export type GalleryImageSource = {
  readonly path: string;
  readonly alt?: string;
  readonly hotspot?: MediaHotspot;
  /**
   * Set on a source whose bytes are not committed yet. Injected server-side and
   * consumed only by {@link mediaUrl} — never written to a `.val.ts`.
   */
  readonly patch_id?: string;
};

export type ImageSource = GalleryImageSource & {
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
};

export type GalleryFileSource = {
  readonly path: string;
  readonly patch_id?: string;
};

export type FileSource = GalleryFileSource & {
  readonly mimeType?: string;
};

/**
 * The structural supertype of every media source.
 *
 * It is a named member of the `Source` / `SelectorSource` unions rather than
 * "just an object" because `SourceObject` is `{[key: string]: Source}` and
 * `Source` excludes `undefined` — an object with optional properties does not
 * satisfy it.
 */
export type MediaSource = ImageSource;

/**
 * TEMPORARY: accept the old marker shape as well as the flat one.
 *
 * Removed in the commit that deletes `c.image` / `c.file` / `c.remote`. It
 * exists only so the read paths and the write paths can be flipped in separate
 * commits while the fixtures still author `{_ref, _type, metadata}` — without
 * it there is no green point between "core has the new types" and "every file
 * in the repo has been rewritten".
 */
export function normalizeMediaSource<S extends object>(src: S): S {
  if (
    !("_ref" in src) ||
    typeof (src as { _ref?: unknown })._ref !== "string"
  ) {
    return src;
  }
  const legacy = src as {
    _ref: string;
    _type?: unknown;
    _tag?: unknown;
    metadata?: Record<string, unknown>;
    patch_id?: string;
  };
  const { _ref, _type, _tag, metadata, ...rest } = legacy;
  void _type;
  void _tag;
  // `patch_id` belongs to the source, never to metadata. Some sources carry a
  // stray one inside `metadata`, where the old readers ignored it; spreading it
  // out would silently turn a published file into a draft.
  const { patch_id: strayPatchId, ...metadataFields } = metadata ?? {};
  void strayPatchId;
  return { ...rest, ...metadataFields, path: _ref } as unknown as S;
}

/** A path is remote unless it is under `/public`. */
export function isRemoteMediaPath(path: string): boolean {
  return !path.startsWith("/public");
}

/**
 * TEMPORARY: the inverse of {@link normalizeMediaSource}.
 *
 * Lets the marker-shape validators accept a flat source while the write paths
 * are being flipped. Deleted, along with `normalizeMediaSource`, in the commit
 * that rewrites the validators for the flat shape.
 */
export function toLegacyMediaSource<S>(src: S): S {
  if (
    typeof src !== "object" ||
    src === null ||
    "_ref" in src ||
    !("path" in src) ||
    typeof (src as { path?: unknown }).path !== "string"
  ) {
    return src;
  }
  const { path, patch_id, ...metadata } = src as {
    path: string;
    patch_id?: string;
    [key: string]: unknown;
  };
  return {
    _ref: path,
    _type: isRemoteMediaPath(path) ? "remote" : "file",
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(patch_id !== undefined ? { patch_id } : {}),
  } as unknown as S;
}

/**
 * Where the bytes of a media source are actually served from.
 *
 * Two states, and conflating them is the recurring bug: uncommitted bytes live
 * in the patch directory and are served by the API with the `patch_id` that put
 * them there; committed bytes live at the path itself, with `/public` stripped.
 */
export function mediaUrl(rawSrc: {
  readonly path: string;
  readonly patch_id?: string;
}): string {
  const src = normalizeMediaSource(rawSrc);
  const path = src.path;
  // TODO: /public should be configurable
  if (!isRemoteMediaPath(path)) {
    if (src.patch_id) {
      return `/api/val/files${path}?patch_id=${src.patch_id}`;
    }
    return path.slice("/public".length);
  }
  if (src.patch_id) {
    const splitRemoteRefRes = splitRemoteRef(path);
    if (splitRemoteRefRes.status === "success") {
      return `/api/val/files/${splitRemoteRefRes.filePath}?patch_id=${src.patch_id}&remote=true&ref=${encodeURIComponent(path)}`;
    }
    // Not a remote ref either — an absolute path outside /public. Serve it as
    // written, but keep the patch id so a draft still resolves.
    return `${path}?patch_id=${src.patch_id}`;
  }
  return path;
}

/**
 * A media source plus the URL its bytes are served from.
 *
 * `url` is the only generated field: everything else the consumer sees was
 * either authored or filled in from the gallery.
 */
export function resolveMedia<S extends { readonly path: string }>(
  rawSrc: S,
): S & { url: string } {
  const src = normalizeMediaSource(rawSrc);
  return { ...src, url: mediaUrl(src) };
}

function isMediaSchema(
  schema: unknown,
): schema is SerializedImageSchema | SerializedFileSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "type" in schema &&
    (schema.type === "image" || schema.type === "file")
  );
}

/**
 * Fill in the metadata a gallery-backed field does not carry itself.
 *
 * `s.image(galleryModule)` stores only `{path, alt?, hotspot?}` — the
 * dimensions and mime type live in the gallery module, keyed by path. This is
 * the single implementation of that lookup; core, stega/RSC and the Studio all
 * call it rather than each rolling their own.
 *
 * The double lookup is load-bearing: a remote gallery keys its entries by the
 * remote URL while the file itself stays on disk under its local path.
 */
export function fillFromGallery<S extends { readonly path: string }>(
  rawSrc: S,
  schema: unknown,
  getModuleSource: (modulePath: string) => unknown,
): S {
  const src = normalizeMediaSource(rawSrc);
  if (!isMediaSchema(schema) || !schema.referencedModule) {
    return src;
  }
  const moduleSource = getModuleSource(schema.referencedModule);
  if (
    !moduleSource ||
    typeof moduleSource !== "object" ||
    Array.isArray(moduleSource)
  ) {
    return src;
  }
  const entries = moduleSource as Record<string, unknown>;
  let key: string | null = src.path in entries ? src.path : null;
  if (key === null) {
    const splitRemoteRefRes = splitRemoteRef(src.path);
    if (
      splitRemoteRefRes.status === "success" &&
      splitRemoteRefRes.filePath in entries
    ) {
      key = splitRemoteRefRes.filePath;
    }
  }
  if (key === null) {
    return src;
  }
  const entry = entries[key];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return src;
  }
  const { width, height, mimeType } = entry as {
    width?: number;
    height?: number;
    mimeType?: string;
  };
  return {
    ...src,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
  };
}
