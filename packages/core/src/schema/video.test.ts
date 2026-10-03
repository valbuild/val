import { initVal } from "../initVal";
import { SourcePath } from "../val";
import { VideoSource, resolveVideo } from "../source/media";
import { deserializeSchema } from "./deserialize";
import { VideoSchema } from "./video";
import { ValidationErrors } from "./validation/ValidationError";
import { Selector, GenericSelector } from "../selector";

const { s } = initVal();
const PATH = "/content/video.val.ts" as SourcePath;

const complete: VideoSource = {
  path: "/public/val/intro_3b9d7.mp4",
  mimeType: "video/mp4",
  width: 1920,
  height: 1080,
  duration: 30,
};

function messages(res: ValidationErrors): string[] {
  if (res === false) {
    return [];
  }
  return Object.values(res).flatMap((errors) => errors.map((e) => e.message));
}

function validate(
  schema: VideoSchema<VideoSource> | VideoSchema<VideoSource | null>,
  src: unknown,
): ValidationErrors {
  return schema["executeValidate"](PATH, src as VideoSource);
}

describe("VideoSchema", () => {
  test("a complete local mp4 is valid", () => {
    expect(validate(s.video(), complete)).toBe(false);
  });

  test("an HLS master playlist is valid, and is not held to accept", () => {
    expect(
      validate(s.video({ accept: "video/mp4", stream: { type: "hls" } }), {
        ...complete,
        path: "/public/val/intro_3b9d7/master.m3u8",
        mimeType: "application/vnd.apple.mpegurl",
      }),
    ).toBe(false);
  });

  test("an HLS mime type on a path that is not a playlist is refused", () => {
    expect(
      messages(
        validate(s.video(), {
          ...complete,
          mimeType: "application/vnd.apple.mpegurl",
        }),
      ),
    ).toEqual([expect.stringContaining("master playlist")]);
  });

  test("missing metadata is a fix, not a plain error", () => {
    const res = validate(s.video(), { path: "/public/val/intro_3b9d7.mp4" });
    expect(res && res[PATH]).toEqual([
      expect.objectContaining({ fixes: ["video:add-metadata"] }),
    ]);
  });

  test("the extension has to be a video and agree with mimeType", () => {
    expect(
      messages(
        validate(s.video(), { ...complete, path: "/public/val/intro.png" }),
      ),
    ).toEqual([expect.stringContaining("file extension")]);
    expect(
      messages(validate(s.video(), { ...complete, mimeType: "video/webm" })),
    ).toEqual([expect.stringContaining("not matching")]);
  });

  test("accept is checked", () => {
    expect(
      messages(validate(s.video({ accept: "video/webm" }), complete)),
    ).toEqual([expect.stringContaining("schema accepts 'video/webm'")]);
  });

  test("times must be inside the video, and start before end", () => {
    expect(
      messages(
        validate(s.video(), {
          ...complete,
          posterTime: 31,
          startTime: 10,
          endTime: 5,
        }),
      ),
    ).toEqual([
      expect.stringContaining("'posterTime' (31s) is after the end"),
      expect.stringContaining("must be before 'endTime'"),
    ]);
    expect(
      messages(validate(s.video(), { ...complete, startTime: -1 })),
    ).toEqual([expect.stringContaining("'startTime' must be a number")]);
  });

  test("hotspot must be inside the frame", () => {
    expect(
      messages(
        validate(s.video(), { ...complete, hotspot: { x: 0.5, y: 1.5 } }),
      ),
    ).toEqual([expect.stringContaining("hotspot")]);
  });

  test("the poster must be an image stored where the video is", () => {
    expect(
      validate(s.video(), {
        ...complete,
        posterTime: 2,
        poster: { path: "/public/val/intro_poster_1a2b3.webp" },
      }),
    ).toBe(false);
    expect(
      messages(
        validate(s.video(), {
          ...complete,
          poster: { path: "/public/val/intro.mp4" },
        }),
      ),
    ).toEqual([expect.stringContaining("must be an image")]);
  });

  test("captions: vtt, a language, at most one default, no repeats", () => {
    expect(
      validate(s.video(), {
        ...complete,
        captions: [
          { path: "/public/val/en.vtt", srclang: "en", label: "English" },
          {
            path: "/public/val/nb.vtt",
            srclang: "nb",
            kind: "captions",
            default: true,
          },
        ],
      }),
    ).toBe(false);
    expect(
      messages(
        validate(s.video(), {
          ...complete,
          captions: [
            { path: "/public/val/en.srt", srclang: "en", default: true },
            { path: "/public/val/en.vtt", srclang: "en", default: true },
            { path: "/public/val/x.vtt", srclang: "" },
          ],
        }),
      ),
    ).toEqual([
      expect.stringContaining("Caption track 1 must be a WebVTT"),
      expect.stringContaining("Caption track 2 repeats the language 'en'"),
      expect.stringContaining("Caption track 3 needs a language"),
      expect.stringContaining("At most one caption track"),
    ]);
  });

  test("local vs remote", () => {
    const remotePath =
      "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abc/f/def/p/public/val/intro.mp4";
    expect(messages(validate(s.video().remote(), complete))).toEqual([
      expect.stringContaining("Expected a remote video"),
    ]);
    expect(
      messages(validate(s.video(), { ...complete, path: remotePath })),
    ).toEqual([expect.stringContaining("Expected a local video")]);
    // A remote video's bytes cannot be re-read locally, so its metadata is
    // not asked for -- only the mime type, which says how to play it.
    expect(
      validate(s.video().remote(), {
        path: remotePath,
        mimeType: "video/mp4",
      }),
    ).toBe(false);
  });

  test("one fix moves every file of the video, wherever the stray one is", () => {
    const remotePath =
      "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abc/f/def/p/public/val/intro.mp4";
    // The video is remote, its poster and caption are not.
    const res = validate(s.video().remote(), {
      path: remotePath,
      mimeType: "video/mp4",
      poster: { path: "/public/val/intro-poster.webp" },
      captions: [{ path: "/public/val/en.vtt", srclang: "en" }],
    });
    expect(res && res[PATH]).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("2 files are stored locally"),
        fixes: ["video:upload-remote"],
      }),
    ]);
    expect(
      (validate(s.video(), { ...complete, path: remotePath }) || {})[PATH],
    ).toEqual([expect.objectContaining({ fixes: ["video:download-remote"] })]);
  });

  test("nullable", () => {
    expect(validate(s.video().nullable(), null)).toBe(false);
    expect(messages(validate(s.video(), null))).toEqual([
      expect.stringContaining("Non-optional video"),
    ]);
  });

  test("assert: an object with a path", () => {
    expect(s.video()["executeAssert"](PATH, complete).success).toBe(true);
    expect(
      s.video()["executeAssert"](PATH, { mimeType: "video/mp4" }).success,
    ).toBe(false);
  });

  test("serializes and deserializes", () => {
    const schema = s
      .video({ dir: "/public/videos", stream: { type: "hls" } })
      .remote()
      .describe("Hero");
    const serialized = schema["executeSerialize"]();
    expect(serialized).toEqual(
      expect.objectContaining({
        type: "video",
        options: { dir: "/public/videos", stream: { type: "hls" } },
        remote: true,
        opt: false,
        description: "Hero",
      }),
    );
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
  });
});

describe("resolveVideo", () => {
  test("every file the video names gets its own url", () => {
    const resolved = resolveVideo({
      ...complete,
      patch_id: "p1",
      poster: { path: "/public/val/intro_poster.webp" },
      captions: [{ path: "/public/val/en.vtt", srclang: "en", patch_id: "p2" }],
    });
    expect(resolved.url).toBe(
      "/api/val/files/public/val/intro_3b9d7.mp4?patch_id=p1",
    );
    expect(resolved.poster?.url).toBe("/val/intro_poster.webp");
    expect(resolved.captions?.[0].url).toBe(
      "/api/val/files/public/val/en.vtt?patch_id=p2",
    );
  });
});

// Type-level: a video selects as a GenericSelector over the video source, not
// as a never.
type VideoSelector = Selector<VideoSource>;
const isGeneric: VideoSelector extends GenericSelector<VideoSource>
  ? true
  : false = true;
void isGeneric;
