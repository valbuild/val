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

import { splitRemoteRef } from "../remote/splitRemoteRef";
import type { SerializedFileSchema } from "../schema/file";
import type { SerializedImageSchema } from "../schema/image";
import type { SerializedVideoSchema } from "../schema/video";

/** What must stay in frame when a page crops an image. */
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
 * The still shown before a video plays — `<video poster>`.
 *
 * Derived, like a video's `width` and `height`: the Studio grabs the frame at
 * {@link VideoSource.posterTime} and uploads it as an image, so a page can show
 * it without decoding the video. It is a media object of its own (a `path`,
 * and a `patch_id` while unpublished) because it is a file of its own.
 */
export type VideoPosterSource = {
  readonly path: string;
  readonly width?: number;
  readonly height?: number;
  readonly mimeType?: string;
  readonly patch_id?: string;
};

/**
 * One text track of a video — `<track src srclang label kind default>`.
 *
 * `path` is a WebVTT file, uploaded like any other file.
 */
export type VideoCaptionSource = {
  readonly path: string;
  /** BCP 47 language tag of the track, e.g. `en` or `nb-NO`. */
  readonly srclang: string;
  /** What a viewer picks from the player's caption menu, e.g. "English". */
  readonly label?: string;
  /**
   * `subtitles` translate the dialogue; `captions` also describe the sound,
   * for viewers who cannot hear it. @default "subtitles"
   */
  readonly kind?: "subtitles" | "captions";
  /** Shown without the viewer turning it on. At most one track may say so. */
  readonly default?: boolean;
  readonly patch_id?: string;
};

/**
 * What a video FIELD authors, on top of the file it names: the description,
 * the crop, the poster, the trim and the caption tracks.
 *
 * This is the whole value of a field picked from an `s.videoset()`
 * (`s.video(videosetVal)`) — the mime type, size and length live in the set,
 * keyed by `path`, and repeating them here is how two copies of one fact get
 * to disagree. The poster, captions and times stay with the FIELD: one video
 * used in two places can be trimmed and captioned differently in each.
 *
 * Times are in seconds from the start of the file.
 */
export type GalleryVideoSource = {
  readonly path: string;
  /** Describes the video for someone who cannot see it. */
  readonly alt?: string;
  /** What must stay in frame when a page crops the video (`object-position`). */
  readonly hotspot?: MediaHotspot;
  /** Seconds. The frame the poster was taken from. */
  readonly posterTime?: number;
  readonly poster?: VideoPosterSource;
  /** Seconds. Where playback starts. */
  readonly startTime?: number;
  /** Seconds. Where playback stops. */
  readonly endTime?: number;
  readonly captions?: readonly VideoCaptionSource[];
  /**
   * Set on a source whose bytes are not committed yet. Injected server-side and
   * consumed only by {@link mediaUrl} — never written to a `.val.ts`.
   */
  readonly patch_id?: string;
};

/**
 * What one page chooses about a video — as opposed to what is true of the
 * file. A field (`s.video()`) carries these for itself; the entry of a set
 * (`s.videoset()`) carries them as DEFAULTS, which every field picked from the
 * set starts from and may override key by key. See {@link fillFromGallery}.
 */
export type VideoDefaults = Pick<
  GalleryVideoSource,
  "hotspot" | "posterTime" | "poster" | "startTime" | "endTime" | "captions"
>;

/**
 * A video: a progressive file (`video/mp4`, `video/webm`) or an HLS stream
 * (`application/vnd.apple.mpegurl`, whose `path` is the master playlist).
 *
 * `mimeType` is REQUIRED on a video of its own: a page has to know which of
 * the two it is holding before it can play it at all — an `.m3u8` handed to a
 * `<video src>` plays only in Safari. (What tells a video's TYPE apart from an
 * image's is its declared keys, see {@link IsVideoSource}, because a field
 * picked from a set has no `mimeType` of its own.)
 *
 * `width`, `height`, `duration` and `mimeType` are read from the bytes;
 * everything else is authored.
 */
export type VideoSource = GalleryVideoSource & {
  readonly mimeType: string;
  readonly width?: number;
  readonly height?: number;
  /** Seconds. */
  readonly duration?: number;
};

/**
 * Whether a source TYPE is a video's.
 *
 * Every media source is "a `path` plus optional fields", so assignability
 * cannot tell an image from a video: an image is assignable to a set-backed
 * video and the other way round. The keys a type DECLARES can — only a video
 * declares `posterTime` — so the readers' conditional types ask this before
 * they ask about images.
 */
export type IsVideoSource<T> = T extends { readonly path: string }
  ? "posterTime" extends keyof T
    ? true
    : false
  : false;

/** The mime type of an HLS master playlist. */
export const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

/** Whether a video is an HLS stream rather than a single progressive file. */
export function isHlsVideo(src: {
  readonly path: string;
  readonly mimeType?: string;
}): boolean {
  if (src.mimeType !== undefined) {
    return (
      src.mimeType === HLS_MIME_TYPE ||
      src.mimeType.toLowerCase() === "application/x-mpegurl"
    );
  }
  return src.path.split("?")[0].toLowerCase().endsWith(".m3u8");
}

/**
 * The structural supertype of every media source.
 *
 * It is a named member of the `Source` / `SelectorSource` unions rather than
 * "just an object" because `SourceObject` is `{[key: string]: Source}` and
 * `Source` excludes `undefined` — an object with optional properties does not
 * satisfy it.
 */
export type MediaSource = ImageSource | VideoSource;

/** A path is remote unless it is under `/public`. */
export function isRemoteMediaPath(path: string): boolean {
  return !path.startsWith("/public");
}

/**
 * Where the bytes of a media source are actually served from.
 *
 * Two states, and conflating them is the recurring bug: uncommitted bytes live
 * in the patch directory and are served by the API with the `patch_id` that put
 * them there; committed bytes live at the path itself, with `/public` stripped.
 */
export function mediaUrl(src: {
  readonly path: string;
  readonly patch_id?: string;
}): string {
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
  src: S,
): S & { url: string } {
  return { ...src, url: mediaUrl(src) };
}

/**
 * A video as a reader sees it: every file it names — the video itself, its
 * poster and each caption track — carries the URL its bytes are served from.
 *
 * Each gets its own {@link mediaUrl} because each is its own file with its own
 * `patch_id`: replacing only the poster drafts the poster, and the video keeps
 * its published URL.
 */
export type ResolvedVideo<S extends GalleryVideoSource = VideoSource> = Omit<
  S,
  "poster" | "captions"
> & {
  readonly url: string;
  readonly poster?: VideoPosterSource & { readonly url: string };
  readonly captions?: readonly (VideoCaptionSource & {
    readonly url: string;
  })[];
};

/**
 * The single implementation of {@link ResolvedVideo}. `url` is passed in as a
 * function so the reader can tag the video's own URL (stega) without tagging
 * the poster's and the captions', which are not where an edit lands.
 */
export function resolveVideo<S extends GalleryVideoSource>(
  src: S,
  videoUrl: (src: S) => string = mediaUrl,
): ResolvedVideo<S> {
  const { poster, captions, ...rest } = src;
  const resolved: ResolvedVideo<S> = { ...rest, url: videoUrl(src) };
  if (poster && typeof poster === "object" && typeof poster.path === "string") {
    return withCaptions(
      { ...resolved, poster: { ...poster, url: mediaUrl(poster) } },
      captions,
    );
  }
  return withCaptions(resolved, captions);
}

function withCaptions<S extends GalleryVideoSource>(
  resolved: ResolvedVideo<S>,
  captions: S["captions"],
): ResolvedVideo<S> {
  if (!Array.isArray(captions)) {
    return resolved;
  }
  return {
    ...resolved,
    captions: captions
      .filter(
        (track): track is VideoCaptionSource =>
          !!track &&
          typeof track === "object" &&
          typeof track.path === "string",
      )
      .map((track) => ({ ...track, url: mediaUrl(track) })),
  };
}

function isMediaSchema(
  schema: unknown,
): schema is
  | SerializedImageSchema
  | SerializedFileSchema
  | SerializedVideoSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    "type" in schema &&
    (schema.type === "image" ||
      schema.type === "file" ||
      schema.type === "video")
  );
}

/**
 * What a gallery entry holds as a DEFAULT for the fields picked from it, in
 * the groups a field overrides together.
 *
 * Per key, not per value: a field that has set its own `startTime` still
 * takes the gallery's `endTime`. The poster is the one pair — `poster` is the
 * frame at `posterTime`, so a field with either has chosen its own still, and
 * taking the other half from the gallery would describe a frame nobody chose.
 */
export const GALLERY_DEFAULT_GROUPS: readonly (readonly string[])[] = [
  ["alt"],
  ["hotspot"],
  ["poster", "posterTime"],
  ["startTime"],
  ["endTime"],
  ["captions"],
];

/** What is true of the file, and the gallery's alone. */
const GALLERY_FILE_FACTS = ["width", "height", "mimeType", "duration"];

/**
 * The gallery entry a gallery-backed value names, or `null` when it is not
 * gallery-backed or the gallery has no such entry.
 *
 * The double lookup is load-bearing: a remote gallery keys its entries by the
 * remote URL while the file itself stays on disk under its local path.
 */
export function galleryEntryOf(
  src: { readonly path: string },
  schema: unknown,
  getModuleSource: (modulePath: string) => unknown,
): Record<string, unknown> | null {
  if (!isMediaSchema(schema) || !schema.referencedModule) {
    return null;
  }
  const moduleSource = getModuleSource(schema.referencedModule);
  if (!isPlainObject(moduleSource)) {
    return null;
  }
  let key: string | null = src.path in moduleSource ? src.path : null;
  if (key === null) {
    const splitRemoteRefRes = splitRemoteRef(src.path);
    if (
      splitRemoteRefRes.status === "success" &&
      splitRemoteRefRes.filePath in moduleSource
    ) {
      key = splitRemoteRefRes.filePath;
    }
  }
  if (key === null) {
    return null;
  }
  const entry = moduleSource[key];
  return isPlainObject(entry) ? entry : null;
}

/**
 * The value a gallery-backed field means: its own keys, and the gallery's
 * where it has none.
 *
 * `s.image(galleryModule)` and `s.video(videosModule)` store only what one
 * page chose — the rest lives in the gallery, keyed by path. Two things come
 * from there:
 *
 * - **What is true of the file** — dimensions, mime type, length. The field
 *   never has these, so they are always the gallery's.
 * - **The defaults** — description, focal point, a video's poster, start, end
 *   and captions ({@link GALLERY_DEFAULT_GROUPS}). An editor sets them once
 *   on the gallery entry; a field that sets its own wins, KEY BY KEY.
 *
 * The single implementation of that merge: core, stega/RSC and the Studio all
 * call it rather than each rolling their own, so a page and the Studio's
 * preview of it cannot disagree about which poster a video has.
 *
 * A gallery whose `alt` schema is a locale record holds an object rather than
 * a string; that is left alone rather than copied into a field typed
 * `string`, and making the override locale-shaped is a separate change.
 */
export function fillFromGallery<S extends { readonly path: string }>(
  src: S,
  schema: unknown,
  getModuleSource: (modulePath: string) => unknown,
): S {
  const entry = galleryEntryOf(src, schema, getModuleSource);
  if (entry === null) {
    return src;
  }
  const own: Record<string, unknown> = { ...src };
  const filled: Record<string, unknown> = {};
  for (const key of GALLERY_FILE_FACTS) {
    if (entry[key] !== undefined) {
      filled[key] = entry[key];
    }
  }
  for (const group of GALLERY_DEFAULT_GROUPS) {
    if (group.some((key) => own[key] !== undefined)) {
      continue;
    }
    for (const key of group) {
      const value = entry[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (key === "alt" && typeof value !== "string") {
        continue;
      }
      filled[key] = value;
    }
  }
  return { ...src, ...filled };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
