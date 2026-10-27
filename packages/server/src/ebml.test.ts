import fs from "fs";
import os from "os";
import path from "path";
import { readEbmlMetadata } from "./ebml";
import {
  bufferByteSource,
  withFileByteSource,
  type ByteSource,
} from "./isoBmff";

/**
 * Real files for what ffmpeg writes (see `extractMetadata.test.ts` for the
 * commands), and elements built by hand for what a browser's MediaRecorder
 * writes and ffmpeg does not: unknown-size Clusters.
 */
const fixtures = path.join(__dirname, "__fixtures__", "video");
const fromFixture = (name: string) =>
  readEbmlMetadata(
    bufferByteSource(fs.readFileSync(path.join(fixtures, name))),
  );

describe("readEbmlMetadata on real files", () => {
  test("a webm", () => {
    expect(fromFixture("tiny.webm")).toEqual({
      width: 64,
      height: 48,
      duration: 1,
    });
  });

  test("non-square pixels report the size the video is SHOWN at", () => {
    // Stored 64x48 with a 2:1 sample aspect ratio, so ffmpeg writes a
    // DisplayWidth of 128.
    expect(fromFixture("anamorphic.webm")).toEqual({
      width: 128,
      height: 48,
      duration: 1,
    });
  });

  test("a webm written to a pipe: an unknown-size Segment and no Duration, so the size and no made-up length", () => {
    expect(fromFixture("live.webm")).toEqual({ width: 64, height: 48 });
  });

  test("not Matroska at all: nothing, and no throw", () => {
    expect(fromFixture("tiny.mp4")).toEqual({});
    expect(readEbmlMetadata(bufferByteSource(Buffer.alloc(0)))).toEqual({});
    expect(
      readEbmlMetadata(bufferByteSource(Buffer.from("not a video at all"))),
    ).toEqual({});
    expect(readEbmlMetadata(bufferByteSource(Buffer.alloc(64)))).toEqual({});
    expect(readEbmlMetadata(bufferByteSource(Buffer.alloc(64, 0xff)))).toEqual(
      {},
    );
  });

  test("a file cut short anywhere: whatever was whole, and no throw", () => {
    const file = fs.readFileSync(path.join(fixtures, "tiny.webm"));
    for (let length = 0; length < 400; length++) {
      expect(() =>
        readEbmlMetadata(bufferByteSource(file.subarray(0, length))),
      ).not.toThrow();
    }
  });
});

// #region hand-built elements
/** An element ID as written: its bytes, length marker included. */
function idBytes(id: number): Buffer {
  const bytes: number[] = [];
  for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return Buffer.from(bytes);
}

/** A size as an 8-byte vint, which is what most muxers write for masters. */
function sizeBytes(size: number): Buffer {
  const b = Buffer.alloc(8);
  b[0] = 0x01;
  b.writeUIntBE(size, 2, 6);
  return b;
}

const UNKNOWN_SIZE = Buffer.from([
  0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
]);

function el(id: number, ...payload: Buffer[]): Buffer {
  const body = Buffer.concat(payload);
  return Buffer.concat([idBytes(id), sizeBytes(body.length), body]);
}

/** An element whose end is not written, as a recording in progress has. */
function unknownSizeEl(id: number, ...payload: Buffer[]): Buffer {
  return Buffer.concat([idBytes(id), UNKNOWN_SIZE, ...payload]);
}

function uint(id: number, value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value, 0);
  return el(id, b);
}

function float64(id: number, value: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(value, 0);
  return el(id, b);
}

function float32(id: number, value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeFloatBE(value, 0);
  return el(id, b);
}

const EBML = 0x1a45dfa3;
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
const SIMPLE_BLOCK = 0xa3;

const ebmlHeader = el(EBML, el(0x4282, Buffer.from("webm", "latin1")));

function videoTrack(...video: Buffer[]): Buffer {
  return el(TRACK_ENTRY, uint(TRACK_TYPE, 1), el(VIDEO, ...video));
}

function audioTrack(): Buffer {
  return el(TRACK_ENTRY, uint(TRACK_TYPE, 2), el(0xe1));
}

function cluster(frameBytes: number): Buffer {
  return el(CLUSTER, el(SIMPLE_BLOCK, Buffer.alloc(frameBytes, 0xab)));
}

function counting(inner: ByteSource): ByteSource & { bytesRead: number } {
  const source = {
    size: inner.size,
    bytesRead: 0,
    read: (offset: number, length: number) => {
      const chunk = inner.read(offset, length);
      source.bytesRead += chunk.length;
      return chunk;
    },
  };
  return source;
}
// #endregion

describe("readEbmlMetadata on hand-built elements", () => {
  test("what MediaRecorder writes: unknown-size Segment and Clusters, no Duration — the size, no length, and no Cluster read", () => {
    const frames = 512 * 1024;
    const file = Buffer.concat([
      ebmlHeader,
      unknownSizeEl(
        SEGMENT,
        el(INFO, uint(TIMECODE_SCALE, 1_000_000)),
        el(
          TRACKS,
          audioTrack(),
          videoTrack(uint(PIXEL_WIDTH, 1280), uint(PIXEL_HEIGHT, 720)),
        ),
        unknownSizeEl(CLUSTER, el(SIMPLE_BLOCK, Buffer.alloc(frames, 0xab))),
        unknownSizeEl(CLUSTER, el(SIMPLE_BLOCK, Buffer.alloc(frames, 0xcd))),
      ),
    ]);
    const source = counting(bufferByteSource(file));
    expect(readEbmlMetadata(source)).toEqual({ width: 1280, height: 720 });
    expect(source.bytesRead).toBeLessThan(1024);
  });

  test("Duration is in ticks of TimecodeScale nanoseconds, as a float of either width", () => {
    const tracks = el(
      TRACKS,
      videoTrack(uint(PIXEL_WIDTH, 640), uint(PIXEL_HEIGHT, 360)),
    );
    const withInfo = (info: Buffer) =>
      readEbmlMetadata(
        bufferByteSource(
          Buffer.concat([ebmlHeader, el(SEGMENT, info, tracks)]),
        ),
      );
    // Default scale: milliseconds.
    expect(withInfo(el(INFO, float64(DURATION, 12_500)))).toMatchObject({
      duration: 12.5,
    });
    expect(withInfo(el(INFO, float32(DURATION, 2_000)))).toMatchObject({
      duration: 2,
    });
    // Microsecond ticks.
    expect(
      withInfo(
        el(INFO, uint(TIMECODE_SCALE, 1_000), float64(DURATION, 3_250_000)),
      ),
    ).toMatchObject({ duration: 3.25 });
  });

  test("a DisplayWidth that is not in pixels is not a size: the pixel size is reported", () => {
    const file = Buffer.concat([
      ebmlHeader,
      el(
        SEGMENT,
        el(
          TRACKS,
          videoTrack(
            uint(PIXEL_WIDTH, 640),
            uint(PIXEL_HEIGHT, 480),
            // DisplayUnit 3: a bare aspect ratio.
            uint(DISPLAY_UNIT, 3),
            uint(DISPLAY_WIDTH, 16),
            uint(DISPLAY_HEIGHT, 9),
          ),
        ),
      ),
    ]);
    expect(readEbmlMetadata(bufferByteSource(file))).toEqual({
      width: 640,
      height: 480,
    });
  });

  test("Info and Tracks after the Clusters are found through the SeekHead, and the Clusters are not read", () => {
    const info = el(INFO, float64(DURATION, 4_000));
    const tracks = el(
      TRACKS,
      videoTrack(uint(PIXEL_WIDTH, 320), uint(PIXEL_HEIGHT, 240)),
    );
    const seekEntry = (id: number, position: number) =>
      el(SEEK, el(SEEK_ID, idBytes(id)), uint(SEEK_POSITION, position));
    // Positions are from the start of the Segment's data, and the SeekHead's
    // own length does not depend on them (fixed-width values).
    const seekHeadLength = el(
      SEEK_HEAD,
      seekEntry(INFO, 0),
      seekEntry(TRACKS, 0),
    ).length;
    const clusters = Buffer.concat([cluster(256 * 1024), cluster(256 * 1024)]);
    const infoAt = seekHeadLength + clusters.length;
    const seekHead = el(
      SEEK_HEAD,
      seekEntry(INFO, infoAt),
      seekEntry(TRACKS, infoAt + info.length),
    );
    const file = Buffer.concat([
      ebmlHeader,
      el(SEGMENT, seekHead, clusters, info, tracks),
    ]);
    const source = counting(bufferByteSource(file));
    expect(readEbmlMetadata(source)).toEqual({
      width: 320,
      height: 240,
      duration: 4,
    });
    expect(source.bytesRead).toBeLessThan(1024);
  });

  test("a SeekHead pointing somewhere else is not trusted", () => {
    const seekHead = el(
      SEEK_HEAD,
      el(SEEK, el(SEEK_ID, idBytes(INFO)), uint(SEEK_POSITION, 3)),
    );
    const file = Buffer.concat([
      ebmlHeader,
      el(SEGMENT, seekHead, cluster(16), el(INFO, float64(DURATION, 1_000))),
    ]);
    expect(readEbmlMetadata(bufferByteSource(file))).toEqual({});
  });

  test("withFileByteSource reads the same answer from disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "val-ebml-"));
    try {
      const file = path.join(dir, "a.webm");
      fs.copyFileSync(path.join(fixtures, "tiny.webm"), file);
      expect(withFileByteSource(file, readEbmlMetadata)).toEqual({
        width: 64,
        height: 48,
        duration: 1,
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
