import fs from "fs";
import path from "path";
import {
  extractVideoMetadata,
  extractVideoMetadataFromFile,
  unreadableVideoMetadataMessage,
} from "./extractMetadata";

/**
 * The fixtures are real files, a few KB each, made with:
 *
 *   ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libx264 \
 *     -pix_fmt yuv420p -preset ultrafast -movflags +faststart tiny.mp4
 *   ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libvpx \
 *     -b:v 50k tiny.webm
 *   ffmpeg -f lavfi -i testsrc=size=64x48:rate=10 -t 1 -c:v libx264 \
 *     -pix_fmt yuv420p -preset ultrafast tiny.mov
 *   ffmpeg -display_rotation 90 -i tiny.mp4 -c copy -movflags +faststart \
 *     rotated.mp4
 *   ffmpeg -i tiny.mp4 -c copy \
 *     -movflags frag_keyframe+empty_moov+default_base_moof fragmented.mp4
 *
 * Real rather than synthesized, because what is under test is that the
 * container headers are read the way a browser reads them.
 */
const fixtures = path.join(__dirname, "__fixtures__", "video");
const fixture = (name: string) => {
  const filename = path.join(fixtures, name);
  return [filename, fs.readFileSync(filename)] as const;
};

describe("extractVideoMetadata", () => {
  test("an mp4: its dimensions, its length, and the extension's mime type", async () => {
    expect(await extractVideoMetadata(...fixture("tiny.mp4"))).toEqual({
      mimeType: "video/mp4",
      width: 64,
      height: 48,
      duration: 1,
    });
  });

  test("a webm: the mime type, and nothing Val would have to decode Matroska for", async () => {
    expect(await extractVideoMetadata(...fixture("tiny.webm"))).toEqual({
      mimeType: "video/webm",
    });
  });

  test("a mov is video/quicktime, which is what validation expects of .mov", async () => {
    expect(await extractVideoMetadata(...fixture("tiny.mov"))).toEqual({
      mimeType: "video/quicktime",
      width: 64,
      height: 48,
      duration: 1,
    });
  });

  test("a rotated video reports the size it is SHOWN at, not the size it is stored at", async () => {
    // A phone records upright video sideways plus a rotation. A page lays it
    // out as it is displayed, so the dimensions are swapped.
    expect(await extractVideoMetadata(...fixture("rotated.mp4"))).toMatchObject(
      { width: 48, height: 64 },
    );
  });

  test("bytes that are not a video: the extension's mime type, and nothing made up", async () => {
    expect(
      await extractVideoMetadata(
        "/public/val/broken.mp4",
        Buffer.from("not a video at all"),
      ),
    ).toEqual({ mimeType: "video/mp4" });
  });

  test("from a file on disk, the same answer", async () => {
    expect(
      await extractVideoMetadataFromFile(path.join(fixtures, "tiny.mp4")),
    ).toEqual({ mimeType: "video/mp4", width: 64, height: 48, duration: 1 });
  });

  test("what to do when Val cannot read it says so", () => {
    expect(
      unreadableVideoMetadataMessage("/public/val/a.webm", [
        "width",
        "height",
        "duration",
      ]),
    ).toBe(
      "Val cannot read the size and length of a .webm file on the command line. Upload it again in the Val Studio, or add width, height and duration by hand.",
    );
    expect(
      unreadableVideoMetadataMessage("/public/val/a.mp4", ["duration"]),
    ).toBe(
      "Val could not read the duration of /public/val/a.mp4. Upload it again in the Val Studio, or add duration by hand.",
    );
  });

  describe("an HLS master playlist", () => {
    const master = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="audio",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud"',
      "480p.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"',
      "720p.m3u8",
      "",
    ].join("\n");
    const media480 = [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-TARGETDURATION:6",
      '#EXT-X-MAP:URI="480p.mp4",BYTERANGE="800@0"',
      "#EXTINF:6.006,",
      "#EXT-X-BYTERANGE:40000@800",
      "480p.mp4",
      "#EXTINF:6.006,",
      "#EXT-X-BYTERANGE:40000@40800",
      "480p.mp4",
      "#EXTINF:2.1,",
      "#EXT-X-BYTERANGE:12000@80800",
      "480p.mp4",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    const dir = "/project/public/val/clip_abc12";
    const files: Record<string, string> = {
      [path.join(dir, "480p.m3u8")]: media480,
    };
    const readFile = (absolutePath: string) =>
      files[absolutePath] !== undefined
        ? Buffer.from(files[absolutePath])
        : undefined;

    test("dimensions of the largest rendition, duration of the first one's segments", async () => {
      expect(
        await extractVideoMetadata(
          path.join(dir, "master.m3u8"),
          Buffer.from(master),
          readFile,
        ),
      ).toEqual({
        mimeType: "application/vnd.apple.mpegurl",
        width: 1280,
        height: 720,
        // 6.006 + 6.006 + 2.1, without the float noise.
        duration: 14.112,
      });
    });

    test("a media playlist that cannot be read leaves duration out rather than guessing", async () => {
      expect(
        await extractVideoMetadata(
          path.join(dir, "master.m3u8"),
          Buffer.from(master),
          () => undefined,
        ),
      ).toEqual({
        mimeType: "application/vnd.apple.mpegurl",
        width: 1280,
        height: 720,
      });
    });

    test("a media playlist on its own knows its length but not its size", async () => {
      expect(
        await extractVideoMetadata(
          path.join(dir, "480p.m3u8"),
          Buffer.from(media480),
          readFile,
        ),
      ).toEqual({
        mimeType: "application/vnd.apple.mpegurl",
        duration: 14.112,
      });
    });
  });
});
