import fs from "fs";
import os from "os";
import path from "path";
import {
  bufferByteSource,
  readIsoBmffMetadata,
  withFileByteSource,
  type ByteSource,
} from "./isoBmff";

/**
 * Real files for what ffmpeg writes (see `extractMetadata.test.ts` for the
 * commands), and boxes built by hand for the branches ffmpeg does not take on
 * a one-second clip: version 1 headers, 64-bit box sizes, `mehd`.
 */
const fixtures = path.join(__dirname, "__fixtures__", "video");
const fromFixture = (name: string) =>
  readIsoBmffMetadata(
    bufferByteSource(fs.readFileSync(path.join(fixtures, name))),
  );

describe("readIsoBmffMetadata on real files", () => {
  test("an mp4", () => {
    expect(fromFixture("tiny.mp4")).toEqual({
      width: 64,
      height: 48,
      duration: 1,
    });
  });

  test("a QuickTime .mov is the same format", () => {
    expect(fromFixture("tiny.mov")).toEqual({
      width: 64,
      height: 48,
      duration: 1,
    });
  });

  test("a video rotated a quarter turn reports the size it is shown at", () => {
    expect(fromFixture("rotated.mp4")).toEqual({
      width: 48,
      height: 64,
      duration: 1,
    });
  });

  test("a fragmented mp4 with an empty moov and no mehd: the size, and no made-up length", () => {
    // ffmpeg -i tiny.mp4 -c copy -movflags frag_keyframe+empty_moov+default_base_moof
    expect(fromFixture("fragmented.mp4")).toEqual({ width: 64, height: 48 });
  });

  test("not ISO BMFF at all: nothing, and no throw", () => {
    expect(fromFixture("tiny.webm")).toEqual({});
    expect(readIsoBmffMetadata(bufferByteSource(Buffer.alloc(0)))).toEqual({});
    expect(
      readIsoBmffMetadata(bufferByteSource(Buffer.from("not a video at all"))),
    ).toEqual({});
  });
});

// #region hand-built boxes
function box(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

/** A box with a 64-bit `largesize`, as a file over 4 GB has for its mdat. */
function largeBox(type: string, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, "latin1");
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
}

function fullBoxHeader(version: number): Buffer {
  return Buffer.from([version, 0, 0, 0]);
}

function mvhd(version: 0 | 1, timescale: number, duration: number): Buffer {
  if (version === 1) {
    const b = Buffer.alloc(28);
    // creation (8), modification (8)
    b.writeUInt32BE(timescale, 16);
    b.writeBigUInt64BE(BigInt(duration), 20);
    return box("mvhd", fullBoxHeader(1), b, Buffer.alloc(80));
  }
  const b = Buffer.alloc(16);
  b.writeUInt32BE(timescale, 8);
  b.writeUInt32BE(duration, 12);
  return box("mvhd", fullBoxHeader(0), b, Buffer.alloc(80));
}

const IDENTITY = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];
const ROTATE_270 = [0, -0x10000, 0, 0x10000, 0, 0, 0, 0, 0x40000000];

function tkhd(
  version: 0 | 1,
  width: number,
  height: number,
  matrix: number[] = IDENTITY,
): Buffer {
  const times = Buffer.alloc(version === 1 ? 32 : 20);
  const middle = Buffer.alloc(16);
  const m = Buffer.alloc(36);
  matrix.forEach((value, i) => m.writeInt32BE(value, i * 4));
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width * 0x10000, 0);
  size.writeUInt32BE(height * 0x10000, 4);
  return box("tkhd", fullBoxHeader(version), times, middle, m, size);
}

function trak(handler: string, header: Buffer): Buffer {
  const hdlr = box(
    "hdlr",
    fullBoxHeader(0),
    Buffer.alloc(4),
    Buffer.from(handler, "latin1"),
    Buffer.alloc(12),
  );
  return box("trak", header, box("mdia", hdlr));
}
// #endregion

describe("readIsoBmffMetadata on hand-built boxes", () => {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1"));

  test("version 1 mvhd and tkhd", () => {
    const file = Buffer.concat([
      ftyp,
      box(
        "moov",
        mvhd(1, 90000, 90000 * 12.5),
        trak("vide", tkhd(1, 1920, 1080)),
      ),
    ]);
    expect(readIsoBmffMetadata(bufferByteSource(file))).toEqual({
      width: 1920,
      height: 1080,
      duration: 12.5,
    });
  });

  test("the picture is the 'vide' trak, wherever it is", () => {
    const file = Buffer.concat([
      ftyp,
      box(
        "moov",
        mvhd(0, 1000, 3000),
        trak("soun", tkhd(0, 0, 0)),
        trak("vide", tkhd(0, 640, 360)),
      ),
    ]);
    expect(readIsoBmffMetadata(bufferByteSource(file))).toMatchObject({
      width: 640,
      height: 360,
    });
  });

  test("a 270° matrix swaps width and height too", () => {
    const file = Buffer.concat([
      ftyp,
      box(
        "moov",
        mvhd(0, 1000, 3000),
        trak("vide", tkhd(0, 1920, 1080, ROTATE_270)),
      ),
    ]);
    expect(readIsoBmffMetadata(bufferByteSource(file))).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  test("a fragmented file's length comes from mehd when mvhd says 0", () => {
    const mehd = Buffer.alloc(4);
    mehd.writeUInt32BE(4500, 0);
    const file = Buffer.concat([
      ftyp,
      box(
        "moov",
        mvhd(0, 1000, 0),
        box("mvex", box("mehd", fullBoxHeader(0), mehd)),
        trak("vide", tkhd(0, 640, 360)),
      ),
    ]);
    expect(readIsoBmffMetadata(bufferByteSource(file))).toMatchObject({
      duration: 4.5,
    });
  });

  test("a moov after a 64-bit mdat is found, and the mdat is never read", () => {
    const mdatBody = Buffer.alloc(1024 * 1024, 0xab);
    const file = Buffer.concat([
      ftyp,
      largeBox("mdat", mdatBody),
      box("moov", mvhd(0, 1000, 2000), trak("vide", tkhd(0, 320, 240))),
    ]);
    const inner = bufferByteSource(file);
    let bytesRead = 0;
    const counting: ByteSource = {
      size: inner.size,
      read: (offset, length) => {
        const chunk = inner.read(offset, length);
        bytesRead += chunk.length;
        return chunk;
      },
    };
    expect(readIsoBmffMetadata(counting)).toEqual({
      width: 320,
      height: 240,
      duration: 2,
    });
    // Box headers on the way, then the moov: nowhere near the megabyte.
    expect(bytesRead).toBeLessThan(1024);
  });

  test("withFileByteSource reads the same answer from disk, and closes the file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-bmff-"));
    try {
      const file = path.join(dir, "a.mp4");
      fs.copyFileSync(path.join(fixtures, "tiny.mp4"), file);
      expect(withFileByteSource(file, readIsoBmffMetadata)).toEqual({
        width: 64,
        height: 48,
        duration: 1,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
