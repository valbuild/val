import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs";
import {
  DEFAULT_VAL_REMOTE_HOST,
  type ModuleFilePath,
  type ModulePath,
} from "@valbuild/core";
import { createService } from "@valbuild/server";
import {
  createDefaultValFSHost,
  runValidation,
  ValidationEvent,
  IValRemote,
} from "./runValidation";

/**
 * `val validate` over a project with an `s.videoset()`, end to end: module
 * loading, the fix handlers, the patches and the `.val.ts` rewrite.
 *
 * The project is written here rather than kept as a fixture because its whole
 * point is a set entry WITHOUT the metadata its type requires — which a
 * fixture `.val.ts` cannot hold and still typecheck.
 */

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");
const TINY_MP4 = path.resolve(
  __dirname,
  "../../server/src/__fixtures__/video/tiny.mp4",
);

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360
playlist-1.m3u8
`;
const PLAYLIST = `#EXTM3U
#EXT-X-MAP:URI="segments-1.mp4",BYTERANGE="10@0"
#EXTINF:2,
#EXT-X-BYTERANGE:20@10
segments-1.mp4
#EXT-X-ENDLIST
`;

const PROJECT: Record<string, string> = {
  "val.modules.ts": `import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/videos.val") },
  { def: () => import("./content/videos-remote.val") },
  { def: () => import("./content/page.val") },
]);
`,
  "content/videos.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/videos.val.ts",
  s.videoset({ dir: "/public/val/videos" }),
  {
    "/public/val/videos/clip_abcde.mp4": { alt: "A clip" },
    "/public/val/videos/intro_05198/master.m3u8": {
      mimeType: "application/vnd.apple.mpegurl",
      width: 640,
      height: 360,
      duration: 2,
      alt: null,
    },
  },
);
`,
  "content/videos-remote.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/videos-remote.val.ts",
  s.videoset({ dir: "/public/val/remote-videos" }).remote(),
  {
    "/public/val/remote-videos/clip_fghij.mp4": {
      mimeType: "video/mp4",
      width: 64,
      height: 48,
      duration: 1,
      alt: null,
    },
  },
);
`,
  "content/page.val.ts": `import { c, s } from "../val.config";
import videosVal from "./videos.val";
import remoteVideosVal from "./videos-remote.val";

export default c.define(
  "/content/page.val.ts",
  s.object({ hero: s.video(videosVal), remoteHero: s.video(remoteVideosVal) }),
  {
    hero: {
      path: "/public/val/videos/clip_abcde.mp4",
      alt: "Kept",
      poster: { path: "/public/val/videos/clip-poster_11111.webp" },
      captions: [{ path: "/public/val/videos/clip-en_22222.vtt", srclang: "en" }],
    },
    remoteHero: { path: "/public/val/remote-videos/clip_fghij.mp4" },
  },
);
`,
  "public/val/videos/intro_05198/master.m3u8": MASTER,
  "public/val/videos/intro_05198/playlist-1.m3u8": PLAYLIST,
  "public/val/videos/intro_05198/segments-1.mp4": "segments",
  // The page's poster and captions live where the set keeps its videos, and
  // are not set entries.
  "public/val/videos/clip-poster_11111.webp": "poster",
  "public/val/videos/clip-en_22222.vtt": "WEBVTT\n",
};

const notExpected: IValRemote = {
  remoteHost: DEFAULT_VAL_REMOTE_HOST,
  getSettings: async () => {
    throw new Error("Not expected to be called");
  },
  uploadFile: async () => {
    throw new Error("Not expected to be called");
  },
};

async function run(
  root: string,
  valFiles: string[],
  fix: boolean,
  remote: IValRemote = notExpected,
): Promise<ValidationEvent[]> {
  const events: ValidationEvent[] = [];
  for await (const event of runValidation({
    root,
    fix,
    valFiles,
    project: fix ? "test/project" : undefined,
    remote,
    fs: createDefaultValFSHost(),
  })) {
    events.push(event);
  }
  return events;
}

async function sourceOf(root: string, moduleFilePath: string) {
  const service = await createService(root, createDefaultValFSHost());
  try {
    const result = await service.get(
      moduleFilePath as ModuleFilePath,
      "" as ModulePath,
      { validate: false },
    );
    return result.source;
  } finally {
    service.dispose();
  }
}

describe("val validate with an s.videoset()", () => {
  let root: string;

  beforeEach(() => {
    const tmpBase = path.join(__dirname, ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    root = fs.mkdtempSync(path.join(tmpBase, "videoset-"));
    for (const file of ["val.config.ts", "tsconfig.json"]) {
      fs.copyFileSync(path.join(BASIC_FIXTURE, file), path.join(root, file));
    }
    for (const [file, content] of Object.entries(PROJECT)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    for (const file of [
      "public/val/videos/clip_abcde.mp4",
      // In the directory, not in the set.
      "public/val/videos/new_33333.mp4",
      "public/val/remote-videos/clip_fghij.mp4",
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.copyFileSync(TINY_MP4, path.join(root, file));
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("reports the missing metadata and the untracked video as fixable, and nothing about the page's poster", async () => {
    const events = await run(
      root,
      ["content/videos.val.ts", "content/page.val.ts"],
      false,
    );
    const fixable = events.filter((e) => e.type === "validation-fixable-error");
    expect(fixable.map((e) => e.sourcePath).sort()).toEqual([
      // The untracked video, on the set: it has no entry to point at yet.
      "/content/videos.val.ts",
      '/content/videos.val.ts?p="/public/val/videos/clip_abcde.mp4"',
    ]);
    expect(events.filter((e) => e.type === "validation-error")).toEqual([]);
    expect(
      fixable.some(
        (e) =>
          e.type === "validation-fixable-error" &&
          e.message.includes("/public/val/videos/new_33333.mp4"),
      ),
    ).toBe(true);
  });

  test("--fix fills the metadata in and adds the untracked video, and then it is valid", async () => {
    await run(root, ["content/videos.val.ts", "content/page.val.ts"], true);
    expect(await sourceOf(root, "/content/videos.val.ts")).toEqual({
      "/public/val/videos/clip_abcde.mp4": {
        alt: "A clip",
        mimeType: "video/mp4",
        width: 64,
        height: 48,
        duration: 1,
      },
      "/public/val/videos/intro_05198/master.m3u8": {
        mimeType: "application/vnd.apple.mpegurl",
        width: 640,
        height: 360,
        duration: 2,
        alt: null,
      },
      "/public/val/videos/new_33333.mp4": {
        alt: null,
        mimeType: "video/mp4",
        width: 64,
        height: 48,
        duration: 1,
      },
    });
    const again = await run(
      root,
      ["content/videos.val.ts", "content/page.val.ts"],
      false,
    );
    expect(again.at(-1)).toEqual({ type: "summary-success" });
  });

  test("--fix uploads a remote set's local entry, renames its key and points the page at it", async () => {
    fs.mkdirSync(path.join(root, ".val"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".val", "pat.json"),
      JSON.stringify({ pat: "test-pat" }),
    );
    const uploaded: string[] = [];
    const remote: IValRemote = {
      remoteHost: DEFAULT_VAL_REMOTE_HOST,
      getSettings: async () => ({
        success: true,
        data: {
          publicProjectId: "pubproj",
          remoteFileBuckets: [{ bucket: "01" }],
        },
      }),
      uploadFile: async (_project, _bucket, fileHash) => {
        uploaded.push(fileHash);
        return { success: true };
      },
    };
    const events = await run(
      root,
      ["content/videos-remote.val.ts"],
      true,
      remote,
    );
    expect(uploaded).toHaveLength(1);
    expect(
      events
        .filter((e) => e.type === "fix-applied")
        .map((e) => e.type === "fix-applied" && e.file)
        .sort(),
    ).toEqual(["content/page.val.ts", "content/videos-remote.val.ts"]);

    const setSource = await sourceOf(root, "/content/videos-remote.val.ts");
    const keys = Object.keys(setSource ?? {});
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(
      /^https:\/\/.*pubproj.*public\/val\/remote-videos\/clip_fghij\.mp4$/,
    );
    expect(await sourceOf(root, "/content/page.val.ts")).toMatchObject({
      hero: { path: "/public/val/videos/clip_abcde.mp4", alt: "Kept" },
      remoteHero: { path: keys[0] },
    });

    // Both modules are valid against each other afterwards.
    const again = await run(
      root,
      ["content/videos-remote.val.ts", "content/page.val.ts"],
      false,
    );
    expect(
      again.filter(
        (e) =>
          e.type === "validation-error" ||
          e.type === "validation-fixable-error",
      ),
    ).toEqual([]);
  });
});
