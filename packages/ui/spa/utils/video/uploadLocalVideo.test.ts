import {
  Internal,
  type ModuleFilePath,
  type SerializedRecordSchema,
} from "@valbuild/core";
import {
  placeLocalVideoFiles,
  videoFieldUploadPatch,
  videoPathsOf,
  videosetEntrySchema,
  videosetEntryUploadPatches,
} from "./uploadLocalVideo";

const REMOTE = {
  publicProjectId: "3f9a2c1",
  bucket: "r2",
  coreVersion: "0.148.1",
  remoteHost: "https://3f9a2c1.valstart.dev/_val",
};
const VIDEOS = "/src/media/videos.val.ts" as ModuleFilePath;
const PAGE = "/src/routes/_site.index.val.ts" as ModuleFilePath;
const KEY = "/public/val/videos/dusk.mp4";
const POSTER = "/public/val/videos/dusk-poster.webp";
const ENTRY = {
  mimeType: "video/mp4",
  width: 1280,
  height: 640,
  duration: 8,
  alt: "Hills",
  poster: {
    path: POSTER,
    width: 1280,
    height: 640,
    mimeType: "image/webp",
  },
  posterTime: 0,
};
const RECORD: SerializedRecordSchema = {
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
  mediaType: "videos",
  accept: "video/*",
  dir: "/public/val/videos",
};

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Internal.getSHA256Hash(bytes);

/** A project's files, as the Studio would read them back. */
function reader(files: Record<string, string>) {
  const read: string[] = [];
  return {
    read,
    fn: async (path: string) => {
      read.push(path);
      const text = files[path];
      if (text === undefined) {
        throw new Error(`Could not read ${path} (HTTP 404).`);
      }
      return new TextEncoder().encode(text);
    },
  };
}

function textOf(dataUrl: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0)),
  );
}

describe("uploading a video's local files from the Studio", () => {
  test("the video and its poster go up, each hashed as the CLI hashes it", async () => {
    const { fn } = reader({ [KEY]: "mp4 bytes", [POSTER]: "webp bytes" });
    const video = { ...ENTRY, path: KEY };
    const schema = videosetEntrySchema(RECORD);
    const files = await placeLocalVideoFiles({
      paths: videoPathsOf(video),
      video,
      schema,
      remote: REMOTE,
      read: fn,
      sha256,
    });
    expect(files.map((file) => [file.localPath, file.owner])).toEqual([
      [KEY, []],
      [POSTER, ["poster"]],
    ]);
    // `metadataOf` in server/src/videoRemote.ts: the video's own size for the
    // video, the poster's for the poster.
    const fileHash = Internal.remote.hashToRemoteFileHash(
      Internal.getSHA256Hash(new TextEncoder().encode("mp4 bytes")),
    );
    const expected = Internal.remote.createRemoteRef(REMOTE.remoteHost, {
      publicProjectId: REMOTE.publicProjectId,
      coreVersion: REMOTE.coreVersion,
      bucket: REMOTE.bucket,
      validationHash: Internal.remote.getValidationHash(
        REMOTE.coreVersion,
        schema,
        "mp4",
        { mimeType: "video/mp4", width: 1280, height: 640 },
        fileHash,
        new TextEncoder(),
      ),
      fileHash,
      filePath: "public/val/videos/dusk.mp4",
    });
    expect(files[0].ref).toBe(expected);
    expect(files[1].metadata).toEqual({
      mimeType: "image/webp",
      width: 1280,
      height: 640,
    });
  });

  test("a stream goes up bottom-up, each playlist naming the refs of what it lists", async () => {
    const MASTER = "/public/val/videos/intro_3b9d7/master.m3u8";
    const { fn, read } = reader({
      [MASTER]: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv0/index.m3u8\n",
      "/public/val/videos/intro_3b9d7/v0/index.m3u8":
        '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg-0.m4s\n',
      "/public/val/videos/intro_3b9d7/v0/init.mp4": "init",
      "/public/val/videos/intro_3b9d7/v0/seg-0.m4s": "segment",
    });
    const video = {
      path: MASTER,
      mimeType: "application/vnd.apple.mpegurl",
      width: 1280,
      height: 720,
      duration: 4,
    };
    const files = await placeLocalVideoFiles({
      paths: videoPathsOf(video),
      video,
      schema: videosetEntrySchema(RECORD),
      remote: REMOTE,
      read: fn,
      sha256,
    });
    expect(read).toEqual([
      MASTER,
      "/public/val/videos/intro_3b9d7/v0/index.m3u8",
      "/public/val/videos/intro_3b9d7/v0/init.mp4",
      "/public/val/videos/intro_3b9d7/v0/seg-0.m4s",
    ]);
    const byPath = new Map(files.map((file) => [file.localPath, file]));
    const media = byPath.get("/public/val/videos/intro_3b9d7/v0/index.m3u8");
    const master = byPath.get(MASTER);
    const init = byPath.get("/public/val/videos/intro_3b9d7/v0/init.mp4");
    const segment = byPath.get("/public/val/videos/intro_3b9d7/v0/seg-0.m4s");
    if (!media || !master || !init || !segment) {
      throw new Error("a file of the stream was not placed");
    }
    expect(textOf(media.dataUrl)).toBe(
      `#EXTM3U\n#EXT-X-MAP:URI="${init.ref}"\n#EXTINF:4,\n${segment.ref}\n`,
    );
    expect(textOf(master.dataUrl)).toContain(media.ref);
    // Every file of the stream is the video's, filed where the video is.
    expect(files.every((file) => file.owner.length === 0)).toBe(true);
  });

  test("a file that cannot be read stops it before anything is written", async () => {
    const { fn } = reader({ [KEY]: "mp4 bytes" });
    const video = { ...ENTRY, path: KEY };
    await expect(
      placeLocalVideoFiles({
        paths: videoPathsOf(video),
        video,
        schema: videosetEntrySchema(RECORD),
        remote: REMOTE,
        read: fn,
        sha256,
      }),
    ).rejects.toThrow("dusk-poster.webp");
  });

  test("a set entry is renamed to its video's ref, its poster pointed at its own, and the fields that picked it follow", async () => {
    const { fn } = reader({ [KEY]: "mp4 bytes", [POSTER]: "webp bytes" });
    const video = { ...ENTRY, path: KEY };
    const files = await placeLocalVideoFiles({
      paths: videoPathsOf(video),
      video,
      schema: videosetEntrySchema(RECORD),
      remote: REMOTE,
      read: fn,
      sha256,
    });
    const [videoFile, posterFile] = files;
    const hero = Internal.joinModuleFilePathAndModulePath(
      PAGE,
      Internal.patchPathToModulePath(["hero", "video"]),
    );
    const built = videosetEntryUploadPatches({
      moduleFilePath: VIDEOS,
      patchPath: [],
      key: KEY,
      entry: ENTRY,
      existingKeys: [KEY],
      referrers: [{ sourcePath: hero, path: KEY, hasPatchId: false }],
      files,
    });
    if (built.status !== "ok") throw new Error(built.message);
    expect(built.primary.patch).toEqual([
      { op: "move", from: [KEY], path: [videoFile.ref] },
      {
        op: "add",
        path: [videoFile.ref, "poster", "path"],
        value: posterFile.ref,
      },
      expect.objectContaining({
        op: "file",
        path: [videoFile.ref],
        filePath: videoFile.ref,
        remote: true,
      }),
      expect.objectContaining({
        op: "file",
        path: [videoFile.ref],
        nestedFilePath: ["poster"],
        filePath: posterFile.ref,
        remote: true,
      }),
    ]);
    expect(built.referrers).toEqual([
      {
        moduleFilePath: PAGE,
        patch: [
          {
            op: "replace",
            path: ["hero", "video", "path"],
            value: videoFile.ref,
          },
        ],
      },
    ]);
  });

  test("a field moves only the paths that are its own", async () => {
    const { fn } = reader({ [POSTER]: "webp bytes" });
    // Picked from a set: the video is the set's, the poster the field's.
    const video = { path: KEY, poster: { path: POSTER, width: 8, height: 8 } };
    const files = await placeLocalVideoFiles({
      paths: videoPathsOf(video).filter(({ at }) => at[0] !== "path"),
      video,
      schema: { type: "video", opt: false, referencedModule: VIDEOS },
      remote: REMOTE,
      read: fn,
      sha256,
    });
    expect(videoFieldUploadPatch(["hero"], video, files)).toEqual([
      { op: "add", path: ["hero", "poster", "path"], value: files[0].ref },
      expect.objectContaining({
        op: "file",
        path: ["hero"],
        nestedFilePath: ["poster"],
      }),
    ]);
  });
});
