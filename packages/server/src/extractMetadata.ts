import {
  FileMetadata,
  ImageMetadata,
  Internal,
  VideoMetadata,
} from "@valbuild/core";
import sizeOf from "image-size";
import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import {
  bufferByteSource,
  readIsoBmffMetadata,
  withFileByteSource,
  type ByteSource,
} from "./isoBmff";
import { readEbmlMetadata } from "./ebml";
import {
  isHlsMasterPlaylist,
  largestHlsVariant,
  parseHlsMasterVariants,
  sumHlsSegmentDurations,
} from "./hls";

export async function extractImageMetadata(
  filename: string,
  input: Buffer,
): Promise<ImageMetadata> {
  const imageSize = sizeOf(new Uint8Array(input));
  let mimeType: string | null = null;
  if (imageSize.type) {
    const possibleMimeType = `image/${imageSize.type}`;
    if (Internal.MIME_TYPES_TO_EXT[possibleMimeType]) {
      mimeType = possibleMimeType;
    }
    const filenameBasedLookup = Internal.filenameToMimeType(filename);
    if (filenameBasedLookup) {
      mimeType = filenameBasedLookup;
    }
  }
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  let { width, height } = imageSize;
  if (!width || !height) {
    width = 0;
    height = 0;
  }
  return {
    width,
    height,
    mimeType,
  };
}

export async function extractFileMetadata(
  filename: string,
  _input: Buffer, // TODO: use buffer to determine mimetype
): Promise<FileMetadata> {
  let mimeType = Internal.filenameToMimeType(filename);
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  return {
    mimeType,
  };
}

/**
 * What `val validate --fix` writes into a video: `mimeType`, `width`, `height`
 * and `duration`, read from the file. A field that cannot be read is left out
 * rather than guessed, and the caller reports it — see
 * {@link unreadableVideoMetadataMessage}.
 *
 * `mimeType` always comes from the file EXTENSION: validation compares the two,
 * so any other answer is one validation rejects. The rest depends on the kind
 * of file:
 *
 * - **ISO BMFF** (`.mp4`, `.m4v`, `.mov`): read from the `moov` box by a small
 *   parser of our own (`isoBmff.ts`). No media library: this package is loaded
 *   by every app that runs Val.
 * - **WebM / Matroska** (`.webm`, `.mkv`): read from the Segment's Info and Tracks by another
 *   (`ebml.ts`). A WebM recorded in a browser does not declare its length, and
 *   then `duration` is left out — the frames are not counted to find it.
 * - **An HLS master playlist** (`.m3u8`): the dimensions are the largest
 *   rendition's `RESOLUTION`, and the duration is the sum of the `#EXTINF`s of
 *   the first media playlist it names, read from disk beside it — which is why
 *   `filename` must be the playlist's path on disk.
 * - **Anything else**: the mime type and nothing more. The Studio reads those
 *   in the browser when they are uploaded.
 */
export async function extractVideoMetadata(
  filename: string,
  input: Buffer,
  readFile: (absolutePath: string) => Buffer | undefined = readFileOrUndefined,
): Promise<VideoMetadata> {
  if (isHlsPath(filename)) {
    return extractHlsMetadata(filename, input.toString("utf-8"), readFile);
  }
  return extractFromByteSource(filename, bufferByteSource(input));
}

/**
 * {@link extractVideoMetadata} for a file on disk, reading only the headers
 * it needs: a video's frames (an mp4's `mdat`, a WebM's Clusters) are most of
 * the file, and are skipped, not loaded.
 */
export async function extractVideoMetadataFromFile(
  absolutePath: string,
): Promise<VideoMetadata> {
  if (isHlsPath(absolutePath)) {
    return extractVideoMetadata(absolutePath, fs.readFileSync(absolutePath));
  }
  return withFileByteSource(absolutePath, (source) =>
    extractFromByteSource(absolutePath, source),
  );
}

const ISO_BMFF_EXTENSIONS = [".mp4", ".m4v", ".mov"];
const EBML_EXTENSIONS = [".webm", ".mkv"];

/** The extensions whose size and length Val reads itself. */
const READABLE_VIDEO_EXTENSIONS = [
  ...ISO_BMFF_EXTENSIONS,
  ...EBML_EXTENSIONS,
  ".m3u8",
];

/**
 * What to tell someone whose video's `fields` could not be read. Names the
 * way out, because "could not read" alone leaves them nowhere to go.
 */
export function unreadableVideoMetadataMessage(
  fileRef: string,
  fields: readonly string[],
): string {
  const extension = extensionOf(fileRef);
  if (!canReadVideoMetadata(fileRef)) {
    return `Val cannot read the size and length of a ${extension || "file without an extension"} file on the command line. Upload it again in the Val Studio, or add ${listOf(fields)} by hand.`;
  }
  return `Val could not read the ${listOf(fields)} of ${fileRef}. Upload it again in the Val Studio, or add ${listOf(fields)} by hand.`;
}

/** Whether Val reads this video's size and length itself, by its extension. */
export function canReadVideoMetadata(fileRef: string): boolean {
  return READABLE_VIDEO_EXTENSIONS.includes(extensionOf(fileRef));
}

function extensionOf(fileRef: string): string {
  return path.extname(fileRef.split("?")[0]).toLowerCase();
}

function listOf(fields: readonly string[]): string {
  return fields.length <= 1
    ? fields.join("")
    : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

function isHlsPath(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".m3u8";
}

export function extractFromByteSource(
  filename: string,
  source: ByteSource,
): VideoMetadata {
  const metadata: VideoMetadata = {};
  const mimeType = Internal.filenameToMimeType(filename);
  if (mimeType) {
    metadata.mimeType = mimeType;
  }
  const extension = extensionOf(filename);
  const read = ISO_BMFF_EXTENSIONS.includes(extension)
    ? readIsoBmffMetadata(source)
    : EBML_EXTENSIONS.includes(extension)
      ? readEbmlMetadata(source)
      : undefined;
  if (!read) {
    return metadata;
  }
  if (read.width !== undefined && read.height !== undefined) {
    metadata.width = read.width;
    metadata.height = read.height;
  }
  const duration = roundSeconds(read.duration);
  if (duration !== undefined) {
    metadata.duration = duration;
  }
  return metadata;
}

/**
 * An HLS stream's metadata from its master playlist's text, and — for the
 * duration — the first media playlist it names, which `readMediaPlaylist`
 * fetches by the URI the master gives (relative to it, or a remote ref). The
 * one implementation for a stream on disk and one on Val Remote.
 */
export async function readHlsMetadata(
  text: string,
  readMediaPlaylist: (uri: string) => Promise<string | undefined>,
): Promise<VideoMetadata> {
  const metadata: VideoMetadata = { mimeType: Internal.media.HLS_MIME_TYPE };
  if (!isHlsMasterPlaylist(text)) {
    // A media playlist on its own: it knows how long it is, not how big.
    const duration = roundSeconds(sumHlsSegmentDurations(text));
    if (duration !== undefined) {
      metadata.duration = duration;
    }
    return metadata;
  }
  const variants = parseHlsMasterVariants(text);
  const largest = largestHlsVariant(variants);
  if (largest) {
    metadata.width = largest.width;
    metadata.height = largest.height;
  }
  // Every rendition is the same length, so the first one listed is as good as
  // any.
  const first = variants[0];
  if (first) {
    const mediaPlaylist = await readMediaPlaylist(first.uri);
    if (mediaPlaylist !== undefined) {
      const duration = roundSeconds(sumHlsSegmentDurations(mediaPlaylist));
      if (duration !== undefined) {
        metadata.duration = duration;
      }
    }
  }
  return metadata;
}

function extractHlsMetadata(
  filename: string,
  text: string,
  readFile: (absolutePath: string) => Buffer | undefined,
): Promise<VideoMetadata> {
  // Only a relative URI can be read from disk: the Studio writes relative
  // URIs into a local stream.
  return readHlsMetadata(text, async (uri) =>
    isRelativeUri(uri)
      ? readFile(
          path.resolve(path.dirname(filename), uri.split(/[?#]/)[0]),
        )?.toString("utf-8")
      : undefined,
  );
}

function isRelativeUri(uri: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith("/");
}

/**
 * Seconds to the millisecond. A duration summed from `#EXTINF`s or computed
 * from timestamps carries float noise (`5.999999999`), and this value is
 * written into a `.val.ts` someone reads.
 */
function roundSeconds(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return Math.round(seconds * 1000) / 1000;
}

function readFileOrUndefined(absolutePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(absolutePath);
  } catch {
    return undefined;
  }
}
