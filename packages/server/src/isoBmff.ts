import fs from "fs";

/**
 * The size and length of an ISO base media file (`.mp4`, `.m4v`, `.mov`),
 * read from its headers. Nothing is decoded.
 *
 * Hand-written rather than a media library, deliberately: `@valbuild/server`
 * is loaded by every app that runs Val, and the four numbers wanted here are
 * three small boxes away from the start of the `moov` box:
 *
 *   moov > mvhd                  timescale and duration (version 0 and 1)
 *   moov > mvex > mehd           duration of a FRAGMENTED file, whose mvhd says 0
 *   moov > trak > tkhd           width and height (16.16 fixed point) and the
 *                                display matrix, for a rotated phone video
 *   moov > trak > mdia > hdlr    `vide`: which trak is the picture
 *
 * Only the box headers are read on the way to `moov`, and then `moov` itself,
 * so a multi-GB file costs a few small reads: `mdat` is seeked past, never
 * loaded. That is what {@link ByteSource} is for.
 */

/** Random access to a file's bytes, so a large `mdat` can be skipped. */
export type ByteSource = {
  readonly size: number;
  /** Up to `length` bytes from `offset`; fewer only at the end of the file. */
  read(offset: number, length: number): Buffer;
};

export function bufferByteSource(buffer: Buffer): ByteSource {
  return {
    size: buffer.length,
    read: (offset, length) => buffer.subarray(offset, offset + length),
  };
}

/**
 * Run `read` against a file on disk, reading only what it asks for. The file
 * is closed afterwards whatever happens.
 */
export function withFileByteSource<T>(
  absolutePath: string,
  read: (source: ByteSource) => T,
): T {
  const fd = fs.openSync(absolutePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    return read({
      size,
      read: (offset, length) => {
        const wanted = Math.max(0, Math.min(length, size - offset));
        const buffer = Buffer.alloc(wanted);
        let filled = 0;
        while (filled < wanted) {
          const n = fs.readSync(
            fd,
            buffer,
            filled,
            wanted - filled,
            offset + filled,
          );
          if (n === 0) {
            break;
          }
          filled += n;
        }
        return buffer.subarray(0, filled);
      },
    });
  } finally {
    fs.closeSync(fd);
  }
}

export type IsoBmffMetadata = {
  width?: number;
  height?: number;
  /** Seconds, unrounded. */
  duration?: number;
};

/**
 * A `moov` larger than this is not a header worth reading into memory. A
 * two-hour film's is a few MB; this is far past any real one.
 */
const MAX_MOOV_SIZE = 64 * 1024 * 1024;

/**
 * Whatever of {@link IsoBmffMetadata} the file declares. A field that cannot be
 * read is absent; nothing here throws on a file that is not ISO BMFF.
 */
export function readIsoBmffMetadata(source: ByteSource): IsoBmffMetadata {
  const moov = findTopLevelBox(source, "moov");
  if (!moov) {
    return {};
  }
  const metadata: IsoBmffMetadata = {};

  const mvhd = childBox(moov, "mvhd");
  const timescaleAndDuration = mvhd ? readMvhd(mvhd) : undefined;
  if (timescaleAndDuration) {
    const { timescale, duration } = timescaleAndDuration;
    if (duration > 0) {
      metadata.duration = duration / timescale;
    } else {
      // A fragmented file (CMAF) says 0 in mvhd and puts the length in mehd,
      // in the same timescale.
      const mehd = childBox(childBox(moov, "mvex"), "mehd");
      const fragmentDuration = mehd ? readMehd(mehd) : undefined;
      if (fragmentDuration !== undefined && fragmentDuration > 0) {
        metadata.duration = fragmentDuration / timescale;
      }
    }
  }

  for (const trak of childBoxes(moov, "trak")) {
    const hdlr = childBox(childBox(trak, "mdia"), "hdlr");
    if (
      !hdlr ||
      hdlr.length < 12 ||
      hdlr.toString("latin1", 8, 12) !== "vide"
    ) {
      continue;
    }
    const tkhd = childBox(trak, "tkhd");
    const size = tkhd ? readTkhd(tkhd) : undefined;
    if (size && size.width > 0 && size.height > 0) {
      metadata.width = size.width;
      metadata.height = size.height;
      break;
    }
  }
  return metadata;
}

/** The payload (after the header) of the first top-level box of a type. */
function findTopLevelBox(source: ByteSource, type: string): Buffer | undefined {
  let offset = 0;
  while (offset + 8 <= source.size) {
    const header = source.read(offset, 16);
    if (header.length < 8) {
      return undefined;
    }
    let size = header.readUInt32BE(0);
    const boxType = header.toString("latin1", 4, 8);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) {
        return undefined;
      }
      size = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = source.size - offset;
    }
    if (size < headerSize) {
      return undefined;
    }
    if (boxType === type) {
      if (size - headerSize > MAX_MOOV_SIZE) {
        return undefined;
      }
      const payload = source.read(offset + headerSize, size - headerSize);
      return payload.length === size - headerSize ? payload : undefined;
    }
    offset += size;
  }
  return undefined;
}

/** Each child box of a container payload, as `[type, payload]`. */
function* boxesIn(payload: Buffer): Generator<[string, Buffer]> {
  let offset = 0;
  while (offset + 8 <= payload.length) {
    let size = payload.readUInt32BE(offset);
    const type = payload.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > payload.length) {
        return;
      }
      size = Number(payload.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = payload.length - offset;
    }
    if (size < headerSize || offset + size > payload.length) {
      return;
    }
    yield [type, payload.subarray(offset + headerSize, offset + size)];
    offset += size;
  }
}

function childBoxes(payload: Buffer | undefined, type: string): Buffer[] {
  if (!payload) {
    return [];
  }
  const found: Buffer[] = [];
  for (const [boxType, child] of boxesIn(payload)) {
    if (boxType === type) {
      found.push(child);
    }
  }
  return found;
}

function childBox(
  payload: Buffer | undefined,
  type: string,
): Buffer | undefined {
  return childBoxes(payload, type)[0];
}

/** "Unknown" in a version 1 box. Not a literal: `0x…n` needs an ES2020 target. */
const ALL_ONES_64 = BigInt("0xffffffffffffffff");

function readMvhd(
  mvhd: Buffer,
): { timescale: number; duration: number } | undefined {
  const version = mvhd[0];
  if (version === 1) {
    if (mvhd.length < 32) return undefined;
    const timescale = mvhd.readUInt32BE(20);
    const duration = mvhd.readBigUInt64BE(24);
    if (timescale === 0 || duration === ALL_ONES_64) {
      return undefined;
    }
    return { timescale, duration: Number(duration) };
  }
  if (mvhd.length < 20) return undefined;
  const timescale = mvhd.readUInt32BE(12);
  const duration = mvhd.readUInt32BE(16);
  // All ones means "unknown" in a version 0 box.
  if (timescale === 0 || duration === 0xffffffff) {
    return undefined;
  }
  return { timescale, duration };
}

function readMehd(mehd: Buffer): number | undefined {
  if (mehd[0] === 1) {
    return mehd.length >= 12 ? Number(mehd.readBigUInt64BE(4)) : undefined;
  }
  return mehd.length >= 8 ? mehd.readUInt32BE(4) : undefined;
}

/**
 * The size a track is SHOWN at: tkhd's width and height, swapped when the
 * display matrix turns the picture a quarter turn — a phone records upright
 * video sideways and says so here, and a page lays it out as it is shown.
 */
function readTkhd(tkhd: Buffer): { width: number; height: number } | undefined {
  // Past the version-specific times and ids, then 16 bytes of reserved,
  // layer, alternate group, volume and reserved, then the 36-byte matrix.
  const matrixAt = tkhd[0] === 1 ? 4 + 32 + 16 : 4 + 20 + 16;
  const widthAt = matrixAt + 36;
  if (tkhd.length < widthAt + 8) {
    return undefined;
  }
  const a = tkhd.readInt32BE(matrixAt);
  const b = tkhd.readInt32BE(matrixAt + 4);
  const c = tkhd.readInt32BE(matrixAt + 12);
  const d = tkhd.readInt32BE(matrixAt + 16);
  const width = Math.round(tkhd.readUInt32BE(widthAt) / 0x10000);
  const height = Math.round(tkhd.readUInt32BE(widthAt + 4) / 0x10000);
  const quarterTurn = a === 0 && d === 0 && b !== 0 && c !== 0;
  return quarterTurn ? { width: height, height: width } : { width, height };
}
