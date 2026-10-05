import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AddressInfo } from "net";
import {
  initVal,
  type ModuleFilePath,
  type SourcePath,
  type ValidationFix,
} from "@valbuild/core";
import { applyPatch, deepClone, JSONOps } from "@valbuild/core/patch";
import type { JSONValue } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { createFixPatch } from "./createFixPatch";
import {
  createDefaultValFSHost,
  type FixHandlerContext,
  type RemoteFileMove,
} from "./fixHandlers";
import { getPersonalAccessTokenPath } from "./personalAccessTokens";
import type { Service } from "./Service";
import {
  handleVideoDownloadRemote,
  handleVideoUploadRemote,
  rewriteVideoPathsPatch,
} from "./videoRemote";

/**
 * A video moved to Val Remote and back, through a stand-in for the content
 * host that stores bytes by hash and serves them by ref, as the real one does
 * (`remoteFileRoutes.ts` in valbuild/home).
 *
 * The round trip is the assertion that matters: every file a video names —
 * including an HLS stream's playlists, which are REWRITTEN on the way up to
 * name refs and on the way down back to relative names — comes back byte for
 * byte.
 */

const { s } = initVal();
const MODULE = "/content/video.val.ts" as ModuleFilePath;
const SOURCE_PATH = `${MODULE}?p="hero"` as SourcePath;

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="a",URI="playlist-2.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360,AUDIO="a"
playlist-1.m3u8
`;
const VIDEO_PLAYLIST = `#EXTM3U
#EXT-X-MAP:URI="segments-1.mp4",BYTERANGE="10@0"
#EXTINF:2,
#EXT-X-BYTERANGE:20@10
segments-1.mp4
#EXT-X-ENDLIST
`;
const AUDIO_PLAYLIST = `#EXTM3U
#EXT-X-MAP:URI="segments-2.mp4",BYTERANGE="10@0"
#EXTINF:2,
#EXT-X-BYTERANGE:20@10
segments-2.mp4
#EXT-X-ENDLIST
`;

const FILES: Record<string, string | Buffer> = {
  "public/val/intro_abcde/master.m3u8": MASTER,
  "public/val/intro_abcde/playlist-1.m3u8": VIDEO_PLAYLIST,
  "public/val/intro_abcde/playlist-2.m3u8": AUDIO_PLAYLIST,
  "public/val/intro_abcde/segments-1.mp4": Buffer.from("video segments ...."),
  "public/val/intro_abcde/segments-2.mp4": Buffer.from("audio segments ...."),
  "public/val/intro-poster_12345.webp": Buffer.from("poster bytes"),
  "public/val/intro-en_67890.vtt": "WEBVTT\n",
};

const LOCAL_VALUE = {
  path: "/public/val/intro_abcde/master.m3u8",
  mimeType: "application/vnd.apple.mpegurl",
  width: 640,
  height: 360,
  duration: 2,
  alt: "Kept as it is",
  posterTime: 1,
  poster: {
    path: "/public/val/intro-poster_12345.webp",
    width: 640,
    height: 360,
    mimeType: "image/webp",
  },
  captions: [
    { path: "/public/val/intro-en_67890.vtt", srclang: "en", label: "English" },
  ],
};

type Host = {
  url: string;
  stored: Map<string, Buffer>;
  close(): Promise<void>;
};

/** Stores by `hash.ext`, serves `/file/p/…/f/{hash}/p/{path}` by hash and extension. */
async function startContentHost(): Promise<Host> {
  const stored = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    const match = /\/f\/([^/]+)\/p\/(.+)$/.exec(req.url ?? "");
    const body = match
      ? stored.get(`${match[1]}.${match[2].split(".").pop()}`)
      : undefined;
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stored,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function writeProject(root: string) {
  for (const [file, content] of Object.entries(FILES)) {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const patFile = getPersonalAccessTokenPath(root);
  fs.mkdirSync(path.dirname(patFile), { recursive: true });
  fs.writeFileSync(patFile, JSON.stringify({ pat: "test-pat" }));
}

function contextFor(
  root: string,
  host: Host,
  remote: boolean,
  value: unknown,
  fix: ValidationFix,
): FixHandlerContext & { remoteFiles: Record<SourcePath, RemoteFileMove> } {
  const schema = s.object({
    hero: remote ? s.video().remote() : s.video(),
  });
  return {
    sourcePath: SOURCE_PATH,
    validationError: { message: "move it", value, fixes: [fix] },
    valModule: {
      path: MODULE as string as SourcePath,
      source: { hero: value as JSONValue },
      schema: schema["executeSerialize"](),
      errors: false,
    },
    projectRoot: root,
    fix: true,
    // The handlers never ask the service anything: what they move is named by
    // the value, and the patch is applied by the caller.
    service: {} as Service,
    valFiles: [],
    moduleFilePath: MODULE,
    file: "content/video.val.ts",
    fs: createDefaultValFSHost(),
    remoteFiles: {},
    remoteFilesCounter: 0,
    project: "test-org/test-project",
    remote: {
      remoteHost: host.url,
      getSettings: async () => ({
        success: true,
        data: {
          publicProjectId: "pub123",
          remoteFileBuckets: [{ bucket: "b1" }],
        },
      }),
      uploadFile: async (_project, _bucket, fileHash, fileExt, buffer) => {
        host.stored.set(`${fileHash}.${fileExt}`, buffer);
        return { success: true };
      },
    },
  };
}

function apply(
  value: unknown,
  patch: ReturnType<typeof rewriteVideoPathsPatch>,
) {
  const res = applyPatch(
    deepClone({ hero: value as JSONValue }),
    new JSONOps(),
    patch,
  );
  if (result.isErr(res)) {
    throw new Error(String(res.error));
  }
  return (res.value as { hero: unknown }).hero;
}

describe("moving a video to Val Remote and back", () => {
  let root: string;
  let host: Host;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-video-remote-"));
    writeProject(root);
    host = await startContentHost();
  });
  afterEach(async () => {
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("every file goes up, every path is rewritten, and it all comes back byte for byte", async () => {
    // --- up ---
    const up = contextFor(root, host, true, LOCAL_VALUE, "video:upload-remote");
    const uploaded = await handleVideoUploadRemote(up);
    expect(uploaded).toMatchObject({ success: true, shouldApplyPatch: true });
    // Seven files: three playlists, two segment files, a poster, a caption.
    expect(host.stored.size).toBe(7);

    const upPatch = await createFixPatch(
      { projectRoot: root, remoteHost: host.url },
      true,
      SOURCE_PATH,
      up.validationError,
      up.remoteFiles,
      up.valModule.source,
      up.valModule.schema,
    );
    // One op per path, never a whole-value replace: authored fields stay.
    expect(upPatch?.patch.map((op) => op.path.join("/"))).toEqual([
      "hero/path",
      "hero/poster/path",
      "hero/captions/0/path",
    ]);
    const remoteValue = apply(LOCAL_VALUE, upPatch?.patch ?? []);
    expect(remoteValue).toMatchObject({
      alt: "Kept as it is",
      captions: [{ srclang: "en", label: "English" }],
    });
    // Valid as a REMOTE video now: nothing is left on the wrong side.
    expect(
      s
        .video()
        .remote()
        ["executeValidate"](SOURCE_PATH, remoteValue as never),
    ).toBe(false);

    // The master on the content host names the media playlists by ref, and
    // each media playlist names its segments by ref.
    const masterRef = (remoteValue as { path: string }).path;
    const masterText = await (await fetch(masterRef)).text();
    const playlistRefs = masterText
      .split("\n")
      .filter((line) => line.startsWith("http"));
    expect(playlistRefs).toHaveLength(1);
    expect(masterText).toMatch(
      /URI="http:\/\/127\.0\.0\.1:\d+\/file\/p\/pub123\//,
    );
    const playlistText = await (await fetch(playlistRefs[0])).text();
    expect(playlistText).toMatch(
      /URI="http.*segments-1\.mp4",BYTERANGE="10@0"/,
    );
    expect(playlistText).toContain("#EXT-X-BYTERANGE:20@10\nhttp");

    // --- and down again, into an empty project ---
    fs.rmSync(path.join(root, "public"), { recursive: true, force: true });
    const down = contextFor(
      root,
      host,
      false,
      remoteValue,
      "video:download-remote",
    );
    const downloaded = await handleVideoDownloadRemote(down);
    expect(downloaded).toMatchObject({ success: true, shouldApplyPatch: true });
    const downPatch = await createFixPatch(
      { projectRoot: root, remoteHost: host.url },
      true,
      SOURCE_PATH,
      down.validationError,
      down.remoteFiles,
      down.valModule.source,
      down.valModule.schema,
    );
    expect(apply(remoteValue, downPatch?.patch ?? [])).toEqual(LOCAL_VALUE);
    for (const [file, content] of Object.entries(FILES)) {
      expect([file, fs.readFileSync(path.join(root, file))]).toEqual([
        file,
        Buffer.from(content),
      ]);
    }
  });

  test("without --fix nothing moves, and it says what --fix would do", async () => {
    const up = contextFor(root, host, true, LOCAL_VALUE, "video:upload-remote");
    const res = await handleVideoUploadRemote({ ...up, fix: false });
    expect(res).toEqual({
      success: false,
      errorMessage: expect.stringContaining("use --fix to upload"),
    });
    expect(host.stored.size).toBe(0);
  });

  test("a missing file stops the upload before anything goes up", async () => {
    fs.rmSync(path.join(root, "public/val/intro-en_67890.vtt"));
    const up = contextFor(root, host, true, LOCAL_VALUE, "video:upload-remote");
    const res = await handleVideoUploadRemote(up);
    expect(res).toEqual({
      success: false,
      errorMessage: expect.stringContaining(
        "intro-en_67890.vtt does not exist",
      ),
    });
    expect(host.stored.size).toBe(0);
  });
});

describe("rewriteVideoPathsPatch", () => {
  test("only the paths that moved", () => {
    expect(
      rewriteVideoPathsPatch(SOURCE_PATH, LOCAL_VALUE, {
        "/public/val/intro-poster_12345.webp": "https://x/poster.webp",
      }),
    ).toEqual([
      {
        op: "add",
        path: ["hero", "poster", "path"],
        value: "https://x/poster.webp",
      },
    ]);
  });
});
