import type { ByteSource } from "./isoBmff";

/**
 * The size and length of a Matroska file (`.webm`, and `.mkv`, which is the
 * same container), read from its headers. Nothing is decoded.
 *
 * Hand-written for the same reason `isoBmff.ts` is: `@valbuild/server` is
 * loaded by every app that runs Val, and what is wanted here is a handful of
 * integers two levels into the file:
 *
 *   EBML                          the header; a file without one is not Matroska
 *   Segment > Info                TimecodeScale and Duration
 *   Segment > Tracks > TrackEntry TrackType 1 (video) >
 *     Video                       PixelWidth / PixelHeight, and DisplayWidth /
 *                                 DisplayHeight when they are in pixels
 *
 * Matroska is EBML: every element is a variable-length ID, a variable-length
 * size and a payload. Only element HEADERS are read on the way through the
 * Segment, and then the payloads of Info and Tracks, which are a few hundred
 * bytes. The Clusters — the frames, which are the file — are never read: the
 * walk stops at the first one.
 *
 * That is allowed because the spec (RFC 9559, section 6.3) requires the first
 * Info and Tracks to come before the first Cluster, or to be named by a
 * SeekHead that does. A file written by a browser's MediaRecorder, or by
 * anything else that streams, does not know its own length when it starts:
 * its Segment and Clusters have the "unknown" size, and its Info has no
 * Duration. The Segment is then read as running to the end of the file, and
 * the duration is left out rather than counted from the Clusters — a caller
 * reports it, as it does for a fragmented mp4.
 */

export type EbmlMetadata = {
  width?: number;
  height?: number;
  /** Seconds, unrounded. */
  duration?: number;
};

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const SEEK = 0x4dbb;
const SEEK_ID = 0x53ab;
const SEEK_POSITION = 0x53ac;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const DISPLAY_WIDTH = 0x54b0;
const DISPLAY_HEIGHT = 0x54ba;
const DISPLAY_UNIT = 0x54b2;
const CLUSTER = 0x1f43b675;

const TRACK_TYPE_VIDEO = 1;
const DISPLAY_UNIT_PIXELS = 0;
/** Nanoseconds per tick, when Info does not say. */
const DEFAULT_TIMECODE_SCALE = 1_000_000;

/**
 * Info, Tracks or a SeekHead larger than this is not a header worth reading
 * into memory. Tracks is the big one, for its codec private data, and that is
 * kilobytes.
 */
const MAX_HEADER_ELEMENT_SIZE = 16 * 1024 * 1024;

/**
 * Whatever of {@link EbmlMetadata} the file declares. A field that cannot be
 * read is absent; nothing here throws on a file that is not Matroska.
 */
export function readEbmlMetadata(source: ByteSource): EbmlMetadata {
  const header = readElementHeader(source, 0);
  if (!header || header.id !== EBML_HEADER || header.size === undefined) {
    return {};
  }
  const segment = findSegment(source, header.dataStart + header.size);
  if (!segment) {
    return {};
  }
  const segmentStart = segment.dataStart;
  const segmentEnd =
    segment.size === undefined
      ? source.size
      : Math.min(source.size, segmentStart + segment.size);

  let info: Buffer | undefined;
  let tracks: Buffer | undefined;
  const seekPositions = new Map<number, number>();
  let offset = segmentStart;
  while (offset < segmentEnd && !(info && tracks)) {
    const element = readElementHeader(source, offset);
    if (!element || element.id === CLUSTER) {
      break;
    }
    if (element.id === INFO && !info) {
      info = readPayload(source, element);
    } else if (element.id === TRACKS && !tracks) {
      tracks = readPayload(source, element);
    } else if (element.id === SEEK_HEAD) {
      const seekHead = readPayload(source, element);
      if (seekHead) {
        readSeekHead(seekHead, seekPositions);
      }
    }
    if (element.size === undefined) {
      // Only a Segment or a Cluster may have an unknown size, and an element
      // whose end is unknown cannot be stepped over.
      break;
    }
    offset = element.dataStart + element.size;
  }
  // Not before the first Cluster: the SeekHead says where.
  if (!info) {
    info = readSought(source, segmentStart, seekPositions, INFO);
  }
  if (!tracks) {
    tracks = readSought(source, segmentStart, seekPositions, TRACKS);
  }

  const metadata: EbmlMetadata = {};
  const duration = info ? readDuration(info) : undefined;
  if (duration !== undefined) {
    metadata.duration = duration;
  }
  const size = tracks ? readVideoSize(tracks) : undefined;
  if (size) {
    metadata.width = size.width;
    metadata.height = size.height;
  }
  return metadata;
}

type ElementHeader = {
  id: number;
  /** `undefined` is the "unknown" size: the element runs until its parent ends. */
  size: number | undefined;
  dataStart: number;
};

/** The first Segment among the top-level elements after the EBML header. */
function findSegment(
  source: ByteSource,
  from: number,
): ElementHeader | undefined {
  let offset = from;
  while (offset < source.size) {
    const element = readElementHeader(source, offset);
    if (!element) {
      return undefined;
    }
    if (element.id === SEGMENT) {
      return element;
    }
    if (element.size === undefined) {
      return undefined;
    }
    offset = element.dataStart + element.size;
  }
  return undefined;
}

function readElementHeader(
  source: ByteSource,
  offset: number,
): ElementHeader | undefined {
  // At most 4 bytes of ID and 8 of size.
  const bytes = source.read(offset, 12);
  const id = readVint(bytes, 0, 4);
  if (!id) {
    return undefined;
  }
  const size = readVint(bytes, id.length, 8);
  if (!size) {
    return undefined;
  }
  return {
    id: id.raw,
    size: size.unknown ? undefined : size.value,
    dataStart: offset + id.length + size.length,
  };
}

function readPayload(
  source: ByteSource,
  element: ElementHeader,
): Buffer | undefined {
  const { size } = element;
  if (size === undefined || size > MAX_HEADER_ELEMENT_SIZE) {
    return undefined;
  }
  const payload = source.read(element.dataStart, size);
  return payload.length === size ? payload : undefined;
}

type Vint = {
  length: number;
  /** All the bytes, the length marker included: how an element ID is written. */
  raw: number;
  /** The bytes with the length marker removed: how a size is written. */
  value: number;
  /** Every value bit set: the reserved "unknown size". */
  unknown: boolean;
};

/**
 * An EBML variable-length integer: the number of leading zero bits of the
 * first byte, plus one, is its length in bytes. Built with arithmetic rather
 * than shifts, which are 32-bit and signed in JavaScript.
 */
function readVint(
  bytes: Buffer,
  offset: number,
  maxLength: number,
): Vint | undefined {
  if (offset >= bytes.length) {
    return undefined;
  }
  const first = bytes[offset];
  if (first === 0) {
    return undefined;
  }
  const length = Math.clz32(first) - 23;
  if (length > maxLength || offset + length > bytes.length) {
    return undefined;
  }
  const valueMask = 0xff >> length;
  let raw = first;
  let value = first & valueMask;
  let unknown = value === valueMask;
  for (let i = 1; i < length; i++) {
    const byte = bytes[offset + i];
    raw = raw * 256 + byte;
    value = value * 256 + byte;
    unknown = unknown && byte === 0xff;
  }
  return { length, raw, value, unknown };
}

/** Each child element of a master element's payload, as `[id, payload]`. */
function* elementsIn(payload: Buffer): Generator<[number, Buffer]> {
  let offset = 0;
  while (offset < payload.length) {
    const id = readVint(payload, offset, 4);
    if (!id) {
      return;
    }
    const size = readVint(payload, offset + id.length, 8);
    if (!size || size.unknown) {
      return;
    }
    const dataStart = offset + id.length + size.length;
    const end = dataStart + size.value;
    if (end > payload.length) {
      return;
    }
    yield [id.raw, payload.subarray(dataStart, end)];
    offset = end;
  }
}

function child(payload: Buffer, id: number): Buffer | undefined {
  for (const [childId, data] of elementsIn(payload)) {
    if (childId === id) {
      return data;
    }
  }
  return undefined;
}

function readUint(data: Buffer | undefined): number | undefined {
  if (!data || data.length > 8) {
    return undefined;
  }
  let value = 0;
  for (const byte of data) {
    value = value * 256 + byte;
  }
  return value;
}

function readFloat(data: Buffer | undefined): number | undefined {
  if (data?.length === 4) {
    return data.readFloatBE(0);
  }
  if (data?.length === 8) {
    return data.readDoubleBE(0);
  }
  return undefined;
}

/** Where each top-level element a SeekHead names is, from the Segment's data. */
function readSeekHead(seekHead: Buffer, into: Map<number, number>): void {
  for (const [id, seek] of elementsIn(seekHead)) {
    if (id !== SEEK) {
      continue;
    }
    const seekId = child(seek, SEEK_ID);
    const position = readUint(child(seek, SEEK_POSITION));
    if (seekId && seekId.length <= 4 && position !== undefined) {
      const target = readUint(seekId);
      if (target !== undefined && !into.has(target)) {
        into.set(target, position);
      }
    }
  }
}

function readSought(
  source: ByteSource,
  segmentStart: number,
  seekPositions: Map<number, number>,
  id: number,
): Buffer | undefined {
  const position = seekPositions.get(id);
  if (position === undefined) {
    return undefined;
  }
  const element = readElementHeader(source, segmentStart + position);
  return element?.id === id ? readPayload(source, element) : undefined;
}

/**
 * Info's Duration is a float in ticks of TimecodeScale nanoseconds. Absent in
 * a file written as it was recorded, and then absent here too.
 */
function readDuration(info: Buffer): number | undefined {
  const duration = readFloat(child(info, DURATION));
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) {
    return undefined;
  }
  const scale = readUint(child(info, TIMECODE_SCALE)) ?? DEFAULT_TIMECODE_SCALE;
  if (scale <= 0) {
    return undefined;
  }
  return (duration * scale) / 1e9;
}

/**
 * The size the first video track is SHOWN at. DisplayWidth and DisplayHeight
 * are what a non-square-pixel (anamorphic) video is laid out at, so they win
 * over the stored PixelWidth and PixelHeight — but only when DisplayUnit says
 * they are pixels. The other units (centimetres, inches, a bare aspect ratio)
 * are not a size a page can use, so the pixel size is reported instead.
 */
function readVideoSize(
  tracks: Buffer,
): { width: number; height: number } | undefined {
  for (const [id, entry] of elementsIn(tracks)) {
    if (
      id !== TRACK_ENTRY ||
      readUint(child(entry, TRACK_TYPE)) !== TRACK_TYPE_VIDEO
    ) {
      continue;
    }
    const video = child(entry, VIDEO);
    if (!video) {
      continue;
    }
    const pixelWidth = readUint(child(video, PIXEL_WIDTH));
    const pixelHeight = readUint(child(video, PIXEL_HEIGHT));
    const displayUnit =
      readUint(child(video, DISPLAY_UNIT)) ?? DISPLAY_UNIT_PIXELS;
    if (displayUnit === DISPLAY_UNIT_PIXELS) {
      const displayWidth = readUint(child(video, DISPLAY_WIDTH));
      const displayHeight = readUint(child(video, DISPLAY_HEIGHT));
      if (displayWidth && displayHeight) {
        return { width: displayWidth, height: displayHeight };
      }
    }
    if (pixelWidth && pixelHeight) {
      return { width: pixelWidth, height: pixelHeight };
    }
  }
  return undefined;
}
