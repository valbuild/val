import fs from "fs";
import os from "os";
import path from "path";
import {
  deserializeSchema,
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationFix,
} from "@valbuild/core";
import { applyPatch, JSONOps } from "@valbuild/core/patch";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { createFixPatch } from "./createFixPatch";
import {
  createDefaultValFSHost,
  currentFixHandlers,
  type FixHandlerContext,
  type RemoteFileMove,
} from "./fixHandlers";
import { checkGalleryFiles } from "./galleryFiles";
import { getPersonalAccessTokenPath } from "./personalAccessTokens";
import type { SerializedModuleContent } from "./SerializedModuleContent";
import type { Service } from "./Service";
import {
  classifyUntrackedVideosetFiles,
  filesNamedByVideoFields,
  filesOfVideosetEntry,
  handleVideosetCheckAllFiles,
  handleVideosetUploadRemote,
  videosetEntryVideoSchema,
  videosetReferencePatches,
  type VideoFieldService,
} from "./videosetFixes";
import { handleVideoUploadRemote } from "./videoRemote";

/**
 * The fixes of an `s.videoset()`.
 *
 * What makes a set of videos more than an image gallery with another mime
 * type is that an entry can be a whole directory (an HLS stream, keyed by its
 * master playlist), that the set's directory holds the posters and captions of
 * the fields that pick from it, and that those fields name an entry by its
 * key — so renaming a key on upload has to rename it there too.
 */

const { s, c } = initVal();

const DIR = "/public/val/videos";
const TINY_MP4 = path.join(__dirname, "__fixtures__", "video", "tiny.mp4");

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="a",URI="playlist-2.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,AUDIO="a"
playlist-1.m3u8
`;
const MEDIA_PLAYLIST = (segments: string) => `#EXTM3U
#EXT-X-MAP:URI="${segments}",BYTERANGE="10@0"
#EXTINF:2,
#EXT-X-BYTERANGE:20@10
${segments}
#EXTINF:1.5,
#EXT-X-BYTERANGE:20@30
${segments}
#EXT-X-ENDLIST
`;

/** A stream as the Studio writes one: a directory named like a file. */
function streamFiles(name: string): Record<string, string | Buffer> {
  return {
    [`${DIR}/${name}/master.m3u8`]: MASTER,
    [`${DIR}/${name}/playlist-1.m3u8`]: MEDIA_PLAYLIST("segments-1.mp4"),
    [`${DIR}/${name}/playlist-2.m3u8`]: MEDIA_PLAYLIST("segments-2.mp4"),
    [`${DIR}/${name}/segments-1.mp4`]: Buffer.from("video segments ...."),
    [`${DIR}/${name}/segments-2.mp4`]: Buffer.from("audio segments ...."),
  };
}

const MP4_ENTRY = {
  mimeType: "video/mp4",
  width: 64,
  height: 48,
  duration: 1,
  alt: "A clip",
};
const HLS_ENTRY = {
  mimeType: "application/vnd.apple.mpegurl",
  width: 640,
  height: 360,
  duration: 3.5,
  alt: null,
};

const SET_PATH = "/content/videos.val.ts" as ModuleFilePath;
const PAGE_PATH = "/content/page.val.ts" as ModuleFilePath;
const OTHER_SET_PATH = "/content/other-videos.val.ts" as ModuleFilePath;

function writeFiles(root: string, files: Record<string, string | Buffer>) {
  for (const [file, content] of Object.entries(files)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

function apply(source: unknown, patch: Patch): JSONValue {
  // A JSON round trip is the clone: a module's source is JSON by definition,
  // but its TYPE is the schema's, which is not `JSONValue`.
  const document: JSONValue = JSON.parse(JSON.stringify(source));
  const res = applyPatch(document, new JSONOps(), patch);
  if (result.isErr(res)) {
    throw new Error(String(res.error));
  }
  return res.value;
}

type DefinedModule = Parameters<typeof Internal.getSource>[0];

/** A module as `Service.get` hands it to a handler. */
function contentOf(
  moduleFilePath: ModuleFilePath,
  module: DefinedModule,
): SerializedModuleContent {
  const schema = Internal.getSchema(module)?.["executeSerialize"]();
  if (!schema) {
    throw new Error(`No schema for ${moduleFilePath}`);
  }
  return {
    path: moduleFilePath as string as SourcePath,
    source: Internal.getSource(module),
    schema,
    errors: false,
  };
}

/** Where the set's entry `key` is, as validation reports it. */
function entryPathOf(key: string): SourcePath {
  const at = Internal.createValPathOfItem(
    SET_PATH as string as SourcePath,
    key,
  );
  if (!at) {
    throw new Error(`No path for ${key}`);
  }
  return at;
}

/** A `Service` that serves `c.define`d modules, which is all the walks ask. */
function serviceOf(
  modules: Record<ModuleFilePath, DefinedModule>,
): VideoFieldService {
  return {
    getModuleFilePaths: () => Object.keys(modules) as ModuleFilePath[],
    get: async (moduleFilePath) =>
      contentOf(moduleFilePath, modules[moduleFilePath]),
  };
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "val-videoset-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("which files a set's directory accounts for", () => {
  test("a stream's playlists and segments are its entry's, not untracked", () => {
    writeFiles(root, {
      ...streamFiles("intro_05198"),
      [`${DIR}/clip_abcde.mp4`]: fs.readFileSync(TINY_MP4),
    });
    const entries: Record<string, unknown> = {
      [`${DIR}/intro_05198/master.m3u8`]: HLS_ENTRY,
      [`${DIR}/clip_abcde.mp4`]: MP4_ENTRY,
    };
    const checked = checkGalleryFiles({
      entryKeys: Object.keys(entries),
      dir: DIR,
      projectRoot: root,
      fs: createDefaultValFSHost(),
      filesOfEntry: (entry, key) =>
        filesOfVideosetEntry(entry, entries[key], { projectRoot: root }),
    });
    expect(checked).toEqual({ missingTrackedFiles: [], untrackedFiles: [] });
  });

  test("an untracked stream is ONE video, keyed by its master", () => {
    writeFiles(root, {
      ...streamFiles("new_11111"),
      [`${DIR}/new-clip_22222.mp4`]: fs.readFileSync(TINY_MP4),
      [`${DIR}/new-clip_33333.webm`]: "webm",
      [`${DIR}/poster_44444.webp`]: "poster",
      [`${DIR}/orphan_55555/playlist-1.m3u8`]: MEDIA_PLAYLIST("x.mp4"),
    });
    const { untrackedFiles } = checkGalleryFiles({
      entryKeys: [],
      dir: DIR,
      projectRoot: root,
      fs: createDefaultValFSHost(),
    });
    const classified = classifyUntrackedVideosetFiles({
      untracked: untrackedFiles,
      accept: "video/mp4",
      projectRoot: root,
    });
    expect(classified.videos.sort()).toEqual([
      `${DIR}/new-clip_22222.mp4`,
      `${DIR}/new_11111/master.m3u8`,
    ]);
    expect(classified.others.sort()).toEqual([
      // Not a type the set accepts: an editor could not have picked it.
      `${DIR}/new-clip_33333.webm`,
      // A media playlist with no master is not a video anyone can play.
      `${DIR}/orphan_55555/playlist-1.m3u8`,
      // Not a video at all.
      `${DIR}/poster_44444.webp`,
    ]);
  });
});

describe("videos:add-metadata", () => {
  test("reads what is missing from the file at the KEY, and keeps the rest", async () => {
    writeFiles(root, { [`${DIR}/clip_abcde.mp4`]: fs.readFileSync(TINY_MP4) });
    // Deserialized, as `val validate` has it: the source is hand-written
    // JSON, which the entry type never saw, carrying an authored `alt` and
    // nothing else.
    const serialized = s.videoset({ dir: DIR })["executeSerialize"]();
    const schema = deserializeSchema(serialized);
    const source = { [`${DIR}/clip_abcde.mp4`]: { alt: "Mine" } };
    const entryPath = entryPathOf(`${DIR}/clip_abcde.mp4`);
    const errors = schema["executeValidate"](
      SET_PATH as string as SourcePath,
      source,
    );
    const error = (errors || {})[entryPath]?.[0];
    expect(error?.fixes).toEqual(["videos:add-metadata"]);
    if (!error) throw new Error("expected an error");

    const fixed = await createFixPatch(
      { projectRoot: root, remoteHost: "https://remote.val.build" },
      true,
      entryPath,
      error,
      {},
      source,
      serialized,
    );
    expect(fixed?.remainingErrors).toEqual([]);
    // One op per field, at the entry's KEY — a path with dots in it.
    expect(fixed?.patch).toEqual([
      {
        op: "add",
        path: [`${DIR}/clip_abcde.mp4`, "mimeType"],
        value: "video/mp4",
      },
      { op: "add", path: [`${DIR}/clip_abcde.mp4`, "width"], value: 64 },
      { op: "add", path: [`${DIR}/clip_abcde.mp4`, "height"], value: 48 },
      { op: "add", path: [`${DIR}/clip_abcde.mp4`, "duration"], value: 1 },
    ]);
    const after = apply(source, fixed?.patch ?? []);
    expect(after).toEqual({
      [`${DIR}/clip_abcde.mp4`]: { ...MP4_ENTRY, alt: "Mine" },
    });
  });

  test("a file Val cannot read is refused with what to do instead", async () => {
    writeFiles(root, { [`${DIR}/clip_abcde.avi`]: "avi" });
    const key = `${DIR}/clip_abcde.avi`;
    const handled = await currentFixHandlers["videos:add-metadata"]({
      ...baseContext(root),
      sourcePath: entryPathOf(key),
      validationError: {
        message: "missing",
        value: { mimeType: "video/x-msvideo" },
        fixes: ["videos:add-metadata"],
      },
    });
    expect(handled).toEqual({
      success: false,
      errorMessage: expect.stringContaining(
        "Upload it again in the Val Studio",
      ),
    });
  });
});

describe("videos:check-all-files", () => {
  const checkError = (fix: ValidationFix) => ({
    message: "may have files not tracked",
    value: { dir: DIR, type: "videos" },
    fixes: [fix],
  });

  test("a stream missing a segment is incomplete, not missing and not fine", async () => {
    const files = streamFiles("intro_05198");
    delete files[`${DIR}/intro_05198/segments-2.mp4`];
    writeFiles(root, files);
    const videosVal = c.define(SET_PATH, s.videoset({ dir: DIR }), {
      [`${DIR}/intro_05198/master.m3u8`]: HLS_ENTRY,
    });
    const service = serviceOf({ [SET_PATH]: videosVal });
    const ctx = {
      ...baseContext(root, service),
      valModule: contentOf(SET_PATH, videosVal),
      sourcePath: SET_PATH as string as SourcePath,
      validationError: checkError("videos:check-all-files"),
    };
    // Not removed by a fix: the entry still names a video someone uploaded.
    expect(await handleVideosetCheckAllFiles(ctx)).toEqual({
      success: false,
      errorMessage: expect.stringContaining(
        `${DIR}/intro_05198/segments-2.mp4`,
      ),
    });
  });
  test("drops entries whose file is gone, and adds the videos it does not list", async () => {
    writeFiles(root, {
      ...streamFiles("intro_05198"),
      ...streamFiles("new_11111"),
      [`${DIR}/clip_abcde.mp4`]: fs.readFileSync(TINY_MP4),
      [`${DIR}/new-clip_22222.mp4`]: fs.readFileSync(TINY_MP4),
      [`${DIR}/intro-poster_33333.webp`]: "poster",
    });
    const schema = s.videoset({ dir: DIR });
    const source: JSONValue = {
      [`${DIR}/intro_05198/master.m3u8`]: HLS_ENTRY,
      [`${DIR}/clip_abcde.mp4`]: MP4_ENTRY,
      [`${DIR}/gone_99999.mp4`]: MP4_ENTRY,
    };
    const run = (apply: boolean) =>
      createFixPatch(
        { projectRoot: root, remoteHost: "https://remote.val.build" },
        apply,
        SET_PATH as string as SourcePath,
        checkError("videos:check-all-files"),
        {},
        source,
        schema["executeSerialize"](),
      );

    const reported = await run(false);
    expect(reported?.patch).toEqual([]);
    expect(reported?.remainingErrors.map((e) => e.message).sort()).toEqual([
      `Video '${DIR}/gone_99999.mp4' is in the set, but its file does not exist. Use --fix to remove it from the set.`,
      `Video '${DIR}/new-clip_22222.mp4' is in '${DIR}' but not in the set. Use --fix to add it.`,
      `Video '${DIR}/new_11111/master.m3u8' is in '${DIR}' but not in the set. Use --fix to add it.`,
    ]);
    // Reported as fixable, so `val validate` says --fix would do it.
    expect(
      reported?.remainingErrors.every(
        (e) => e.fixes?.[0] === "videos:check-all-files",
      ),
    ).toBe(true);

    const fixed = await run(true);
    expect(fixed?.remainingErrors).toEqual([]);
    const after = apply(source, fixed?.patch ?? []);
    expect(after).toEqual({
      [`${DIR}/intro_05198/master.m3u8`]: HLS_ENTRY,
      [`${DIR}/clip_abcde.mp4`]: MP4_ENTRY,
      [`${DIR}/new-clip_22222.mp4`]: { ...MP4_ENTRY, alt: null },
      // The largest rendition's size, and the length of its playlist.
      [`${DIR}/new_11111/master.m3u8`]: { ...HLS_ENTRY, alt: null },
    });
    // What it wrote is a valid set — apart from the two checks only the CLI
    // can answer, which every set carries.
    const remaining = Object.values(
      schema["executeValidate"](
        SET_PATH as string as SourcePath,
        after as never,
      ) || {},
    )
      .flat()
      .flatMap((e) => e.fixes ?? [e.message]);
    expect(remaining).toEqual([
      "videos:check-unique-folder",
      "videos:check-all-files",
    ]);
  });

  test("a poster or caption a video field names is accounted for; a stray file is not", async () => {
    writeFiles(root, {
      [`${DIR}/clip_abcde.mp4`]: fs.readFileSync(TINY_MP4),
      [`${DIR}/clip-poster_33333.webp`]: "poster",
      [`${DIR}/clip-en_44444.vtt`]: "WEBVTT\n",
    });
    const videosVal = c.define(SET_PATH, s.videoset({ dir: DIR }), {
      [`${DIR}/clip_abcde.mp4`]: MP4_ENTRY,
    });
    const pageVal = c.define(
      PAGE_PATH,
      s.object({ hero: s.video(videosVal) }),
      {
        hero: {
          path: `${DIR}/clip_abcde.mp4`,
          poster: { path: `${DIR}/clip-poster_33333.webp` },
          captions: [{ path: `${DIR}/clip-en_44444.vtt`, srclang: "en" }],
        },
      },
    );
    const service = serviceOf({ [SET_PATH]: videosVal, [PAGE_PATH]: pageVal });
    expect(
      [
        ...(await filesNamedByVideoFields(service, { projectRoot: root })),
      ].sort(),
    ).toEqual([
      `${DIR}/clip-en_44444.vtt`,
      `${DIR}/clip-poster_33333.webp`,
      `${DIR}/clip_abcde.mp4`,
    ]);

    const ctx = {
      ...baseContext(root, service),
      valModule: contentOf(SET_PATH, videosVal),
      sourcePath: SET_PATH as string as SourcePath,
      validationError: checkError("videos:check-all-files"),
    };
    expect(await handleVideosetCheckAllFiles(ctx)).toEqual({
      success: true,
      shouldApplyPatch: true,
    });

    writeFiles(root, { [`${DIR}/notes.txt`]: "stray" });
    expect(await handleVideosetCheckAllFiles(ctx)).toEqual({
      success: false,
      errorMessage: expect.stringContaining(`${DIR}/notes.txt`),
    });
  });
});

describe("videos:check-remote", () => {
  test("is reported as it is, not silently dropped", async () => {
    const handled = await currentFixHandlers["videos:check-remote"]({
      ...baseContext(root),
      validationError: {
        message: "Remote URLs are not allowed. Use .remote()",
        value: "https://example.com/x.mp4",
        fixes: ["videos:check-remote"],
      },
    });
    expect(handled).toEqual({
      success: false,
      errorMessage: "Remote URLs are not allowed. Use .remote()",
    });
  });
});

describe("moving a set's video to Val Remote", () => {
  const STREAM_KEY = `${DIR}/intro_05198/master.m3u8`;

  function setup() {
    writeFiles(root, {
      ...streamFiles("intro_05198"),
      [`${DIR}/intro-poster_33333.webp`]: "poster",
      [`${DIR}/intro-en_44444.vtt`]: "WEBVTT\n",
    });
    const patFile = getPersonalAccessTokenPath(root);
    fs.mkdirSync(path.dirname(patFile), { recursive: true });
    fs.writeFileSync(patFile, JSON.stringify({ pat: "test-pat" }));
    const videosVal = c.define(SET_PATH, s.videoset({ dir: DIR }).remote(), {
      [STREAM_KEY]: HLS_ENTRY,
    });
    // Another set with the same key string: its fields name ITS file, and
    // must be left alone.
    const otherVal = c.define(
      OTHER_SET_PATH,
      s.videoset({ dir: "/public/val/other" }),
      {},
    );
    const pageVal = c.define(
      PAGE_PATH,
      s.object({
        hero: s.video(videosVal),
        list: s.array(s.object({ clip: s.video(videosVal).nullable() })),
        unrelated: s.video(otherVal).nullable(),
      }),
      {
        hero: {
          path: STREAM_KEY,
          alt: "Kept as it is",
          poster: { path: `${DIR}/intro-poster_33333.webp` },
          captions: [{ path: `${DIR}/intro-en_44444.vtt`, srclang: "en" }],
        },
        list: [{ clip: null }, { clip: { path: STREAM_KEY } }],
        unrelated: { path: STREAM_KEY },
      },
    );
    return { videosVal, pageVal, otherVal };
  }

  test("the whole stream goes up, the key is renamed, and the fields follow", async () => {
    const { videosVal, pageVal, otherVal } = setup();
    const stored = new Map<string, Buffer>();
    const entryPath = entryPathOf(STREAM_KEY);
    const errors = Internal.getSchema(videosVal)?.["executeValidate"](
      SET_PATH as string as SourcePath,
      Internal.getSource(videosVal),
    );
    const uploadError = (errors || {})[entryPath]?.[0];
    expect(uploadError?.fixes).toEqual(["videos:upload-remote"]);
    if (!uploadError) throw new Error("expected an upload error");

    const ctx: FixHandlerContext & {
      remoteFiles: Record<SourcePath, RemoteFileMove>;
    } = {
      ...baseContext(
        root,
        serviceOf({
          [SET_PATH]: videosVal,
          [OTHER_SET_PATH]: otherVal,
          [PAGE_PATH]: pageVal,
        }),
        stored,
      ),
      valModule: contentOf(SET_PATH, videosVal),
      sourcePath: entryPath,
      validationError: uploadError,
    };
    const handled = await handleVideosetUploadRemote(ctx);
    expect(handled).toMatchObject({ success: true, shouldApplyPatch: true });
    // Three playlists and two segment files. The poster and the caption are
    // the FIELD's, and stay where they are: they are `video:upload-remote`'s.
    expect(stored.size).toBe(5);

    const ref = ctx.remoteFiles[entryPath]?.ref;
    expect(ref).toMatch(/^https:\/\/remote\.val\.build\/file\/p\/pub123\//);
    expect(ref).toContain("public/val/videos/intro_05198/master.m3u8");
    if (!ref) throw new Error("no ref");
    // The master on the host names its playlists by ref, not relatively.
    const masterBytes = [...stored.values()]
      .map((b) => b.toString("utf-8"))
      .find((text) => text.includes("#EXT-X-STREAM-INF"));
    expect(masterBytes).toContain('URI="https://remote.val.build/file/p/');
    expect(masterBytes?.split("\n")).not.toContain("playlist-1.m3u8");

    // The set: the key is renamed, the entry is the same.
    const setPatch = await createFixPatch(
      { projectRoot: root, remoteHost: "https://remote.val.build" },
      true,
      entryPath,
      uploadError,
      ctx.remoteFiles,
      ctx.valModule.source,
      ctx.valModule.schema,
    );
    expect(setPatch?.remainingErrors).toEqual([]);
    const setAfter = apply(
      Internal.getSource(videosVal),
      setPatch?.patch ?? [],
    );
    expect(setAfter).toEqual({ [ref]: HLS_ENTRY });

    // The page: every field of THIS set that held the old key now holds the
    // ref, one op on `path` each — and nothing else is touched.
    expect(handled.otherModulePatches).toEqual([
      {
        moduleFilePath: PAGE_PATH,
        patch: [
          { op: "add", path: ["hero", "path"], value: ref },
          { op: "add", path: ["list", "1", "clip", "path"], value: ref },
        ],
      },
    ]);
    const pageAfter = apply(
      Internal.getSource(pageVal),
      handled.otherModulePatches?.[0]?.patch ?? [],
    );
    expect(pageAfter).toEqual({
      hero: {
        path: ref,
        alt: "Kept as it is",
        poster: { path: `${DIR}/intro-poster_33333.webp` },
        captions: [{ path: `${DIR}/intro-en_44444.vtt`, srclang: "en" }],
      },
      list: [{ clip: null }, { clip: { path: ref } }],
      unrelated: { path: STREAM_KEY },
    });
  });

  test("a set-backed field's own upload moves its poster and captions, never the set's video", async () => {
    const { pageVal } = setup();
    const stored = new Map<string, Buffer>();
    const heroPath = `${PAGE_PATH}?p="hero"` as SourcePath;
    const ctx: FixHandlerContext & {
      remoteFiles: Record<SourcePath, RemoteFileMove>;
    } = {
      ...baseContext(root, undefined, stored),
      valModule: contentOf(PAGE_PATH, pageVal),
      sourcePath: heroPath,
      validationError: {
        message: "Expected a remote video",
        value: {},
        fixes: ["video:upload-remote"],
      },
      moduleFilePath: PAGE_PATH,
    };
    const handled = await handleVideoUploadRemote(ctx);
    expect(handled).toMatchObject({ success: true, shouldApplyPatch: true });
    expect(stored.size).toBe(2);
    const fixed = await createFixPatch(
      { projectRoot: root, remoteHost: "https://remote.val.build" },
      true,
      heroPath,
      ctx.validationError,
      ctx.remoteFiles,
      ctx.valModule.source,
      ctx.valModule.schema,
    );
    expect(fixed?.patch.map((op) => op.path.join("/"))).toEqual([
      "hero/poster/path",
      "hero/captions/0/path",
    ]);
  });

  test("without --fix nothing goes up", async () => {
    setup();
    const res = await handleVideosetUploadRemote({
      ...baseContext(root),
      fix: false,
      validationError: {
        message: "upload it",
        value: STREAM_KEY,
        fixes: ["videos:upload-remote"],
      },
    });
    expect(res).toEqual({
      success: false,
      errorMessage: expect.stringContaining("use --fix to upload"),
    });
  });

  test("a missing segment stops the upload before anything goes up", async () => {
    const { videosVal } = setup();
    fs.rmSync(path.join(root, DIR, "intro_05198", "segments-2.mp4"));
    const stored = new Map<string, Buffer>();
    const entryPath = entryPathOf(STREAM_KEY);
    const res = await handleVideosetUploadRemote({
      ...baseContext(root, undefined, stored),
      valModule: contentOf(SET_PATH, videosVal),
      sourcePath: entryPath,
      validationError: {
        message: "upload it",
        value: STREAM_KEY,
        fixes: ["videos:upload-remote"],
      },
    });
    expect(res).toEqual({
      success: false,
      errorMessage: expect.stringContaining("segments-2.mp4 does not exist"),
    });
    expect(stored.size).toBe(0);
  });
});

describe("videosetReferencePatches", () => {
  test("nothing to rewrite when no field names the key", async () => {
    const videosVal = c.define(SET_PATH, s.videoset({ dir: DIR }), {});
    expect(
      await videosetReferencePatches(
        serviceOf({ [SET_PATH]: videosVal }),
        SET_PATH,
        { [`${DIR}/a.mp4`]: "https://x/a.mp4" },
      ),
    ).toEqual([]);
  });
});

describe("videosetEntryVideoSchema", () => {
  test("is the set's accept and dir, and never its stream option", () => {
    const record = s
      .videoset({ dir: DIR, accept: "video/mp4", stream: { type: "hls" } })
      .remote()
      ["executeSerialize"]();
    if (record.type !== "record") throw new Error("expected a record");
    expect(videosetEntryVideoSchema(record)).toEqual({
      type: "video",
      opt: false,
      options: { accept: "video/mp4", dir: DIR },
    });
  });
});

/**
 * A handler context for a set module, with a content host that stores what it
 * is sent in `stored`.
 */
function baseContext(
  projectRoot: string,
  service?: VideoFieldService,
  stored: Map<string, Buffer> = new Map(),
): FixHandlerContext & { remoteFiles: Record<SourcePath, RemoteFileMove> } {
  return {
    sourcePath: SET_PATH as string as SourcePath,
    validationError: { message: "" },
    // An empty set; a test about a module passes its own.
    valModule: contentOf(
      SET_PATH,
      c.define(SET_PATH, s.videoset({ dir: DIR }), {}),
    ),
    projectRoot,
    fix: true,
    // The walks ask only `getModuleFilePaths` and `get`; a test that does not
    // reach them passes nothing at all.
    service: (service ?? {}) as Service,
    valFiles: [],
    moduleFilePath: SET_PATH,
    file: SET_PATH.slice(1),
    fs: createDefaultValFSHost(),
    remoteFiles: {},
    remoteFilesCounter: 0,
    project: "test-org/test-project",
    remote: {
      remoteHost: "https://remote.val.build",
      getSettings: async () => ({
        success: true,
        data: {
          publicProjectId: "pub123",
          remoteFileBuckets: [{ bucket: "b1" }],
        },
      }),
      uploadFile: async (_project, _bucket, fileHash, fileExt, buffer) => {
        stored.set(`${fileHash}.${fileExt}`, buffer);
        return { success: true };
      },
    },
  };
}
