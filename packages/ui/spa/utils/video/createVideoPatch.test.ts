import { Internal, initVal } from "@valbuild/core";
import type { SerializedVideoSchema } from "@valbuild/core";
import {
  bytesToBase64,
  createCaptionPatch,
  createPosterPatch,
  createVideoPatch,
  type UploadFile,
} from "./createVideoPatch";

const { s } = initVal();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const sha256 = Internal.getSHA256Hash;

function schemaOf(schema: ReturnType<typeof s.video>): SerializedVideoSchema {
  const serialized = schema["executeSerialize"]();
  if (serialized.type !== "video") {
    throw new Error("expected a video schema");
  }
  return serialized;
}

function file(content: string, mimeType: string): UploadFile {
  const bytes = textEncoder.encode(content);
  return {
    bytes,
    mimeType,
    sha256: sha256(bytes),
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
  };
}

function decodeDataUrl(dataUrl: unknown): string {
  if (typeof dataUrl !== "string") throw new Error("not a data url");
  const base64 = dataUrl.split(",")[1];
  return textDecoder.decode(
    Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
  );
}

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
playlist-1.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-MAP:URI="segments-1.mp4",BYTERANGE="800@0"
#EXTINF:6.0,
#EXT-X-BYTERANGE:1000@800
segments-1.mp4
#EXT-X-ENDLIST
`;
const metadata = { width: 1920, height: 1080, duration: 12.345 };
const REMOTE = {
  publicProjectId: "proj",
  coreVersion: "1.0.0",
  bucket: "01",
  remoteHost: "https://remote.val.build",
};

describe("createVideoPatch", () => {
  test("a local mp4: one replace, one file op for the video, one for the poster", () => {
    const video = file("fake mp4", "video/mp4");
    const poster = {
      ...file("fake webp", "image/webp"),
      width: 640,
      height: 360,
    };
    const { patch, value } = createVideoPatch(
      {
        patchPath: ["hero"],
        dir: "/public/val",
        filename: "My Intro.mp4",
        upload: { kind: "file", file: video },
        metadata,
        poster,
        posterTime: 1,
        keep: { alt: "Kept", captions: undefined, hotspot: undefined },
        remote: null,
        schema: schemaOf(s.video()),
      },
      sha256,
    );
    const suffix = video.sha256.slice(0, 5);
    expect(value).toEqual({
      path: `/public/val/myintro_${suffix}.mp4`,
      mimeType: "video/mp4",
      width: 1920,
      height: 1080,
      duration: 12.35,
      alt: "Kept",
      posterTime: 1,
      poster: {
        path: `/public/val/myintro-poster_${poster.sha256.slice(0, 5)}.webp`,
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
    });
    expect(patch.map((op) => op.op)).toEqual(["replace", "file", "file"]);
    expect(patch[1]).toMatchObject({
      path: ["hero"],
      filePath: value.path,
      value: video.dataUrl,
      remote: false,
    });
    expect(patch[1]).not.toHaveProperty("nestedFilePath");
    expect(patch[2]).toMatchObject({
      path: ["hero"],
      nestedFilePath: ["poster"],
      filePath: value.poster?.path,
    });
    // The value validates against the schema it was made for.
    expect(s.video()["executeValidate"]("/x.val.ts" as never, value)).toBe(
      false,
    );
  });

  test("a local HLS stream: a directory named like a file, relative playlists untouched", () => {
    const files = {
      "master.m3u8": file(MASTER, "application/vnd.apple.mpegurl"),
      "playlist-1.m3u8": file(MEDIA, "application/vnd.apple.mpegurl"),
      "segments-1.mp4": file("segment bytes", "video/mp4"),
    };
    const { patch, value } = createVideoPatch(
      {
        patchPath: ["hero"],
        dir: "/public/videos/",
        filename: "intro.mov",
        upload: {
          kind: "hls",
          files,
          sourceSha256: "abcde12345",
          sourceMimeType: "video/quicktime",
        },
        metadata,
        poster: null,
        posterTime: null,
        keep: {},
        remote: null,
        schema: schemaOf(s.video({ stream: { type: "hls" } })),
      },
      sha256,
    );
    expect(value.path).toBe("/public/videos/intro_abcde/master.m3u8");
    expect(value.mimeType).toBe("application/vnd.apple.mpegurl");
    expect(value).not.toHaveProperty("poster");
    const fileOps = patch.filter((op) => op.op === "file");
    expect(fileOps.map((op) => op.op === "file" && op.filePath)).toEqual([
      "/public/videos/intro_abcde/segments-1.mp4",
      "/public/videos/intro_abcde/playlist-1.m3u8",
      "/public/videos/intro_abcde/master.m3u8",
    ]);
    expect(decodeDataUrl(fileOps[2].op === "file" && fileOps[2].value)).toBe(
      MASTER,
    );
    expect(
      s
        .video({ stream: { type: "hls" } })
        ["executeValidate"]("/x.val.ts" as never, value),
    ).toBe(false);
  });

  test("a remote HLS stream: every playlist names the refs of what it lists", () => {
    const files = {
      "master.m3u8": file(MASTER, "application/vnd.apple.mpegurl"),
      "playlist-1.m3u8": file(MEDIA, "application/vnd.apple.mpegurl"),
      "segments-1.mp4": file("segment bytes", "video/mp4"),
    };
    const { patch, value } = createVideoPatch(
      {
        patchPath: ["hero"],
        dir: "/public/val",
        filename: "intro.mp4",
        upload: {
          kind: "hls",
          files,
          sourceSha256: "abcde12345",
          sourceMimeType: "video/mp4",
        },
        metadata,
        poster: null,
        posterTime: null,
        keep: {},
        remote: REMOTE,
        schema: schemaOf(s.video({ stream: { type: "hls" } }).remote()),
      },
      sha256,
    );
    const fileOps = patch.flatMap((op) => (op.op === "file" ? [op] : []));
    const [segment, media, master] = fileOps;
    expect(fileOps.every((op) => op.remote)).toBe(true);
    for (const op of fileOps) {
      const split = Internal.remote.splitRemoteRef(op.filePath);
      expect(split.status).toBe("success");
    }
    expect(value.path).toBe(master.filePath);
    const mediaText = decodeDataUrl(media.value);
    expect(mediaText).toContain(`URI="${segment.filePath}"`);
    expect(mediaText).toContain(`\n${segment.filePath}\n`);
    expect(decodeDataUrl(master.value)).toContain(`\n${media.filePath}\n`);
    // The ref's hash is of the REWRITTEN playlist, the bytes that go up.
    const split = Internal.remote.splitRemoteRef(media.filePath);
    expect(split.status === "success" && split.fileHash).toBe(
      Internal.remote.hashToRemoteFileHash(
        sha256(textEncoder.encode(mediaText)),
      ),
    );
  });
});

describe("createPosterPatch", () => {
  test("adds posterTime and poster, and a file op landing its patch_id on the poster", () => {
    const poster = { ...file("webp", "image/webp"), width: 320, height: 180 };
    const patch = createPosterPatch({
      patchPath: ["hero"],
      dir: "/public/val",
      videoPath: "/public/val/intro_abcde/master.m3u8",
      poster,
      posterTime: 3.14159,
      remote: null,
      schema: schemaOf(s.video()),
    });
    expect(patch[0]).toEqual({
      op: "add",
      path: ["hero", "posterTime"],
      value: 3.14,
    });
    expect(patch[1]).toMatchObject({
      op: "add",
      path: ["hero", "poster"],
      value: {
        path: `/public/val/intro-poster_${poster.sha256.slice(0, 5)}.webp`,
      },
    });
    expect(patch[2]).toMatchObject({
      op: "file",
      nestedFilePath: ["poster"],
    });
  });
});

describe("createCaptionPatch", () => {
  const vtt = file("WEBVTT\n", "text/vtt");
  const base = {
    patchPath: ["hero"],
    dir: "/public/val",
    filename: "intro.en.vtt",
    file: vtt,
    track: { srclang: "en", label: "English" },
    remote: null,
    schema: schemaOf(s.video()),
  };
  test("the first track creates the list", () => {
    const patch = createCaptionPatch({ ...base, existing: undefined });
    expect(patch[0]).toMatchObject({
      op: "add",
      path: ["hero", "captions"],
      value: [{ srclang: "en", label: "English" }],
    });
    expect(patch[1]).toMatchObject({ nestedFilePath: ["captions", "0"] });
  });
  test("a later track is appended", () => {
    const patch = createCaptionPatch({
      ...base,
      existing: [{ path: "/public/val/nb.vtt", srclang: "nb" }],
    });
    expect(patch[0]).toMatchObject({
      op: "add",
      path: ["hero", "captions", "1"],
    });
    expect(patch[1]).toMatchObject({ nestedFilePath: ["captions", "1"] });
  });
});
