import { SourcePath } from "../val";
import { initVal } from "../initVal";
import { deserializeSchema } from "./deserialize";
import type { ValidationError } from "./validation/ValidationError";

const { s, c } = initVal();
const path = "/videos.val.ts" as SourcePath;
const fieldPath = '/page.val.ts?p="intro"' as SourcePath;

const MP4 = {
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  duration: 12.5,
  alt: null,
};
const HLS = {
  mimeType: "application/vnd.apple.mpegurl",
  width: 1920,
  height: 1080,
  duration: 30,
  alt: "A stream",
};
const REMOTE =
  "https://remote.val.build/file/p/proj/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/videos/remote.mp4";

/** The errors a schema reports, without the two that only the CLI answers. */
function errorsOf(
  result: false | Record<string, ValidationError[]>,
): Record<string, ValidationError[]> {
  const deferred = ["videos:check-unique-folder", "videos:check-all-files"];
  const out: Record<string, ValidationError[]> = {};
  for (const [at, errors] of Object.entries(result || {})) {
    const kept = errors.filter(
      (e) => !e.fixes?.some((fix) => deferred.includes(fix)),
    );
    if (kept.length > 0) out[at] = kept;
  }
  return out;
}

function fixesOf(result: false | Record<string, ValidationError[]>) {
  return Object.values(errorsOf(result)).flatMap((errors) =>
    errors.flatMap((e) => e.fixes ?? []),
  );
}

describe("s.videoset()", () => {
  test("a set of an mp4 and an HLS stream is valid", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    expect(
      errorsOf(
        schema["executeValidate"](path, {
          "/public/val/videos/intro_51df2.mp4": MP4,
          "/public/val/videos/intro_05198/master.m3u8": HLS,
        }),
      ),
    ).toEqual({});
  });

  test("the folder checks are reported for the CLI", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    const fixes = Object.values(schema["executeValidate"](path, {}) || {})
      .flat()
      .flatMap((e) => e.fixes ?? []);
    expect(fixes).toEqual([
      "videos:check-unique-folder",
      "videos:check-all-files",
    ]);
  });

  test("missing metadata on a local entry is a fix, not an error", () => {
    // Deserialized, as the Studio has it: the source is hand-written JSON,
    // which the entry type never saw.
    const schema = deserializeSchema(
      s.videoset({ dir: "/public/val/videos" })["executeSerialize"](),
    );
    expect(
      fixesOf(
        schema["executeValidate"](path, {
          "/public/val/videos/clip.mp4": { alt: null },
        }),
      ),
    ).toEqual(["videos:add-metadata"]);
  });

  test("metadata present and wrong is an error", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    const errors = errorsOf(
      schema["executeValidate"](path, {
        "/public/val/videos/clip.mp4": { ...MP4, duration: -1 },
      }),
    );
    expect(
      Object.values(errors)
        .flat()
        .map((e) => e.message),
    ).toEqual(["Expected 'duration' to be a positive number, got '-1'"]);
  });

  test("accept is checked for files, and not for streams", () => {
    const schema = s.videoset({
      dir: "/public/val/videos",
      accept: "video/webm",
    });
    const errors = errorsOf(
      schema["executeValidate"](path, {
        "/public/val/videos/clip.mp4": MP4,
        "/public/val/videos/intro_05198/master.m3u8": HLS,
      }),
    );
    expect(Object.keys(errors)).toEqual([
      '/videos.val.ts?p="/public/val/videos/clip.mp4"',
    ]);
  });

  test("a stream must be keyed by its master playlist", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    const errors = errorsOf(
      schema["executeValidate"](path, {
        "/public/val/videos/intro_05198/segments-1.mp4": HLS,
      }),
    );
    expect(Object.values(errors).flat()[0].message).toMatch(/master playlist/);
  });

  test("a key outside the directory is an error", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    expect(
      Object.keys(
        errorsOf(
          schema["executeValidate"](path, { "/public/val/clip.mp4": MP4 }),
        ),
      ),
    ).toHaveLength(1);
  });

  test("remote: a local entry is to be uploaded, a remote one is accepted", () => {
    const schema = s.videoset({ dir: "/public/val/videos" }).remote();
    expect(
      fixesOf(
        schema["executeValidate"](path, {
          "/public/val/videos/clip.mp4": MP4,
          [REMOTE]: MP4,
        }),
      ),
    ).toEqual(["videos:upload-remote"]);
  });

  test("not remote: a remote entry is refused", () => {
    const schema = s.videoset({ dir: "/public/val/videos" });
    expect(fixesOf(schema["executeValidate"](path, { [REMOTE]: MP4 }))).toEqual(
      ["videos:check-remote"],
    );
  });

  test("serializes what a backed field and the Studio need", () => {
    const serialized = s
      .videoset({ dir: "/public/val/videos", stream: { type: "hls" } })
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "record",
      mediaType: "videos",
      accept: "video/*",
      dir: "/public/val/videos",
      remote: false,
      stream: { type: "hls" },
    });
  });

  test("survives a round trip through deserialization", () => {
    const serialized = s
      .videoset({ dir: "/public/val/videos", stream: { type: "hls" } })
      .remote()
      ["executeSerialize"]();
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
  });
});

describe("s.video(videoset)", () => {
  const videosVal = c.define(
    "/videos.val.ts",
    s.videoset({ dir: "/public/val/videos" }),
    {
      "/public/val/videos/intro_51df2.mp4": MP4,
    },
  );

  test("a field naming an entry of the set is valid", () => {
    const schema = s.video(videosVal);
    expect(
      schema["executeValidate"](fieldPath, {
        path: "/public/val/videos/intro_51df2.mp4",
        startTime: 1,
        endTime: 10,
        hotspot: { x: 0.5, y: 0.5 },
        captions: [{ path: "/public/val/videos/intro_en.vtt", srclang: "en" }],
      }),
    ).toBe(false);
  });

  test("a field naming no entry of the set is an error", () => {
    const schema = s.video(videosVal);
    const errors = schema["executeValidate"](fieldPath, {
      path: "/public/val/videos/other.mp4",
    });
    expect(errors && errors[fieldPath][0].message).toMatch(
      /does not have a video/,
    );
  });

  test("the set's metadata must not be repeated on the field", () => {
    const schema = s.video(videosVal);
    const errors = schema["executeValidate"](fieldPath, {
      path: "/public/val/videos/intro_51df2.mp4",
      // A type error in a .val.ts; hand-written JSON never saw the type.
      ...{ mimeType: "video/mp4" },
    });
    expect(errors && errors[fieldPath][0].message).toMatch(
      /must not carry its own mimeType/,
    );
  });

  test("times are checked against the set's duration", () => {
    const schema = s.video(videosVal);
    const errors = schema["executeValidate"](fieldPath, {
      path: "/public/val/videos/intro_51df2.mp4",
      endTime: 60,
    });
    expect(errors && errors[fieldPath][0].message).toMatch(
      /after the end of the video \(12.5s\)/,
    );
  });

  test("serializes the set it picks from, and its remote flag", () => {
    const remoteVal = c.define(
      "/remote-videos.val.ts",
      s.videoset({ dir: "/public/val/videos" }).remote(),
      {},
    );
    expect(s.video(videosVal)["executeSerialize"]()).toMatchObject({
      type: "video",
      referencedModule: "/videos.val.ts",
      remote: false,
    });
    expect(s.video(remoteVal)["executeSerialize"]()).toMatchObject({
      referencedModule: "/remote-videos.val.ts",
      remote: true,
    });
  });

  test("a remote set's field keeps its poster on the content host too", () => {
    const remoteVal = c.define(
      "/remote-videos.val.ts",
      s.videoset({ dir: "/public/val/videos" }).remote(),
      { [REMOTE]: MP4 },
    );
    const errors = s.video(remoteVal)["executeValidate"](fieldPath, {
      path: REMOTE,
      poster: { path: "/public/val/videos/poster.jpg" },
    });
    expect(errors && errors[fieldPath][0].fixes).toEqual([
      "video:upload-remote",
    ]);
  });

  test("a deserialized field still knows it is set-backed", () => {
    const serialized = s.video(videosVal)["executeSerialize"]();
    const schema = deserializeSchema(serialized);
    expect(schema["executeSerialize"]()).toEqual(serialized);
    // It cannot see the set's entries, so it does not claim the entry is
    // missing — and it still refuses metadata of the field's own.
    expect(
      schema["executeValidate"](fieldPath, {
        path: "/public/val/videos/anything.mp4",
      }),
    ).toBe(false);
  });

  test("only a videoset can back a video", () => {
    // The same shape as a set, which is what the type can check. Whether it
    // IS a set is what decides where uploads land, so it is checked when the
    // schema is made.
    const lookalikeVal = c.define(
      "/lookalike.val.ts",
      s.record(
        s.object({
          mimeType: s.string(),
          width: s.number(),
          height: s.number(),
          duration: s.number(),
          alt: s.string().nullable(),
        }),
      ),
      {},
    );
    expect(() => s.video(lookalikeVal)).toThrow(/must be an s.videoset\(\)/);
  });
});
