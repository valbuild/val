import {
  Internal,
  initVal,
  type PatchId,
  type SelectorSource,
  type SerializedSchema,
  type SerializedVideoSchema,
  type ValModule,
} from "@valbuild/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFilePatch } from "../../packages/ui/spa/components/fields/createFilePatch";
import { mediaPickPatch } from "../../packages/ui/spa/components/fields/mediaPickPatch";
import {
  createVideoPatch,
  createVideosetEntryPatch,
  createPosterPatch,
  type UploadFile,
} from "../../packages/ui/spa/utils/video/createVideoPatch";
import {
  fieldOf,
  keysOf,
  kept,
  matrix,
  type Cell,
  type CellContext,
  type Surface,
} from "./matrix/harness";
import type { Studio } from "./world/createWorld";

// See `smoke.scenario.test.ts` and the README for these two.
jest.mock(
  "@tanstack/react-start/server",
  () => jest.requireActual("./world/tanstackStart"),
  { virtual: true },
);
jest.mock("../../packages/ui/spa/validation/schemaValidationBridge", () =>
  jest.requireActual("./world/noWorkerBridge"),
);

/**
 * The matrix for media that is not in a library -- plain `s.image()`,
 * `s.file()` and `s.video()` fields -- and for a video library
 * (`s.videodir`) with a field picking from it that overrides some of the
 * library's defaults.
 *
 * Uploads go through the product's patch builders (`createFilePatch` for an
 * image or file field, `createVideoPatch` for a video field,
 * `createVideosetEntryPatch` and `createPosterPatch` for a library), written
 * and uploaded the way a field writes them. What the browser does first --
 * reading the file, decoding it for its size, converting a video -- is the
 * environment's, and is given here.
 */

const { s, c, config } = initVal({});
type AnyModule = ValModule<SelectorSource>;

/** Why cells fail today. Evidence and suspected cause are in the README. */

const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (ch) => ch.charCodeAt(0),
);
const MP4 = new TextEncoder().encode("not really an mp4, but bytes");
const PDF = new TextEncoder().encode("%PDF-1.4 a test file");

/** What reading a file gives: the browser's part (`FileReader`, `readFile`). */
function uploadFile(bytes: Uint8Array, mimeType: string): UploadFile {
  return {
    bytes,
    dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    mimeType,
    sha256: Internal.getSHA256Hash(bytes),
  };
}

const publishedUrl = (ref: string) => ref.replace(/^\/public/, "");

/** The field's value on every surface, and whether its URLs serve `bytes`. */
function fieldSurfaces(module: AnyModule, bytes: Uint8Array): Surface[] {
  const servedBy = (surfaceName: string): Surface => ({
    kind: "after",
    name: `GET ${surfaceName} url`,
    read: async (ctx) => {
      const url = fieldOf(ctx.shown[surfaceName], ["url"]);
      if (typeof url !== "string") return `(no url: ${JSON.stringify(url)})`;
      const res = await ctx.world.network.fetchFor("page:/")(url, {
        method: "GET",
      });
      const body = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        sameBytes: Buffer.from(body).equals(Buffer.from(bytes)),
      };
    },
  });
  return [
    { kind: "studio", name: "studio field", module, field: ["media"] },
    {
      kind: "server",
      name: "fetchVal field",
      read: async (val) => fieldOf(await val.fetchVal(module), ["media"]),
    },
    { kind: "hook", name: "useVal field", module, field: ["media"] },
    servedBy("fetchVal field"),
    servedBy("useVal field"),
  ];
}

/** Where a surface read lands on disk, and whether it holds `bytes`. */
function onDisk(bytes: Uint8Array): Surface {
  return {
    kind: "after",
    name: "file on disk",
    read: async (ctx) => {
      if (ctx.world.server.mode !== "fs") return "(memory)";
      try {
        return Buffer.from(
          readFileSync(join(ctx.world.server.root, kept(ctx, "ref"))),
        ).equals(Buffer.from(bytes));
      } catch {
        return "(missing)";
      }
    },
  };
}

/** The serialized schema of a module's `media` field, as the field component is handed it. */
function mediaSchema(module: AnyModule): SerializedSchema {
  const root = Internal.getSchema(module)?.["executeSerialize"]();
  const media = root?.type === "object" ? root.items["media"] : undefined;
  if (media === undefined) throw new Error("no media field");
  return media;
}

function videoSchemaOf(schema: SerializedSchema): SerializedVideoSchema {
  if (schema.type !== "video") throw new Error("not a video schema");
  return schema;
}

// ---------------------------------------------------------------------------
// Plain image and file fields

type Plain = {
  name: string;
  module: AnyModule;
  changed: AnyModule;
  bytes: Uint8Array;
  upload: (studio: Studio) => Promise<{ ref: string; patchId: PatchId }>;
  sourceText: Record<string, string>;
};

function plainImage(): Plain {
  const path = "/content/plain-image.val.ts";
  const module = c.define(path, s.object({ media: s.image().nullable() }), {
    media: null,
  });
  const changed = c.define(
    path,
    s.object({ media: s.image({ accept: "image/png" }).nullable() }),
    { media: null },
  );
  return {
    name: "plain s.image()",
    module,
    changed,
    bytes: PNG_1x1,
    upload: async (studio) => {
      const file = uploadFile(PNG_1x1, "image/png");
      const { patch, filePath } = await createFilePatch(
        ["media"],
        file.dataUrl,
        "new.png",
        file.sha256,
        { width: 1, height: 1, mimeType: "image/png" },
        "image",
        null,
      );
      return {
        ref: filePath,
        patchId: await studio.write(module, patch, "image"),
      };
    },
    sourceText: {
      [path]: `import { c, s } from "../val.config";

export default c.define(
  "${path}",
  s.object({ media: s.image().nullable() }),
  { media: null },
);
`,
    },
  };
}

function plainFile(): Plain {
  const path = "/content/plain-file.val.ts";
  const module = c.define(path, s.object({ media: s.file().nullable() }), {
    media: null,
  });
  const changed = c.define(
    path,
    s.object({ media: s.file({ accept: "application/pdf" }).nullable() }),
    { media: null },
  );
  return {
    name: "plain s.file()",
    module,
    changed,
    bytes: PDF,
    upload: async (studio) => {
      const file = uploadFile(PDF, "application/pdf");
      const { patch, filePath } = await createFilePatch(
        ["media"],
        file.dataUrl,
        "new.pdf",
        file.sha256,
        { mimeType: "application/pdf" },
        "file",
        null,
      );
      return {
        ref: filePath,
        patchId: await studio.write(module, patch, "file"),
      };
    },
    sourceText: {
      [path]: `import { c, s } from "../val.config";

export default c.define(
  "${path}",
  s.object({ media: s.file().nullable() }),
  { media: null },
);
`,
    },
  };
}

function plainVideo(): Plain {
  const path = "/content/plain-video.val.ts";
  const module = c.define(path, s.object({ media: s.video().nullable() }), {
    media: null,
  });
  const changed = c.define(
    path,
    s.object({ media: s.video({ accept: "video/mp4" }).nullable() }),
    { media: null },
  );
  return {
    name: "plain s.video()",
    module,
    changed,
    bytes: MP4,
    upload: async (studio) => {
      const { patch, value } = createVideoPatch(
        {
          patchPath: ["media"],
          dir: "/public/val",
          filename: "new.mp4",
          upload: { kind: "file", file: uploadFile(MP4, "video/mp4") },
          metadata: { width: 640, height: 360, duration: 4 },
          poster: null,
          posterTime: null,
          keep: {},
          remote: null,
          schema: videoSchemaOf(mediaSchema(module)),
        },
        Internal.getSHA256Hash,
      );
      return {
        ref: value.path,
        patchId: await studio.write(module, patch, "file"),
      };
    },
    sourceText: {
      [path]: `import { c, s } from "../val.config";

export default c.define(
  "${path}",
  s.object({ media: s.video().nullable() }),
  { media: null },
);
`,
    },
  };
}

function plainCells(p: Plain): Cell[] {
  const surfaces = fieldSurfaces(p.module, p.bytes);
  const draft = (ctx: CellContext) =>
    expect.objectContaining({
      path: kept(ctx, "ref"),
      url: expect.stringContaining(`patch_id=${kept(ctx, "patch")}`),
    });
  return [
    {
      operation: "upload",
      surfaces,
      run: async (ctx) => {
        const { ref, patchId } = await p.upload(ctx.editor);
        ctx.kept["ref"] = ref;
        ctx.kept["patch"] = patchId;
      },
      expected: (ctx) => ({
        "studio field": expect.objectContaining({ path: kept(ctx, "ref") }),
        "fetchVal field": draft(ctx),
        "useVal field": draft(ctx),
        "GET fetchVal field url": { status: 200, sameBytes: true },
        "GET useVal field url": { status: 200, sameBytes: true },
      }),
    },
    {
      operation: "discard an upload",
      surfaces: surfaces.filter((s) => s.kind !== "after"),
      neverGoesBack: false,
      run: async (ctx) => {
        const { patchId } = await p.upload(ctx.editor);
        await ctx.world.settle();
        await ctx.editor.discard([patchId]);
      },
      expected: () => ({
        "studio field": null,
        "fetchVal field": null,
        "useVal field": null,
      }),
    },
    {
      operation: "publish an upload",
      only: {
        modes: ["fs"],
        why: "memory mode refuses to publish a local file (ValOpsMemory.uploadRemoteFiles); a hosted project's media is remote",
      },
      surfaces: [
        ...surfaces.filter((s) => s.kind !== "after"),
        ...surfaces.filter((s) => s.name === "GET useVal field url"),
        onDisk(p.bytes),
      ],
      run: async (ctx) => {
        const { ref } = await p.upload(ctx.editor);
        ctx.kept["ref"] = ref;
        await ctx.world.settle();
        ctx.kept["publish"] = (await ctx.editor.publish()).status;
      },
      expected: (ctx) => {
        const published = expect.objectContaining({
          path: kept(ctx, "ref"),
          url: publishedUrl(kept(ctx, "ref")),
        });
        return {
          "studio field": expect.objectContaining({ path: kept(ctx, "ref") }),
          "fetchVal field": published,
          "useVal field": published,
          "GET useVal field url": { status: 200, sameBytes: true },
          "file on disk": true,
        };
      },
    },
    {
      operation: "another editor's upload, via /stat",
      surfaces,
      run: async (ctx) => {
        const { ref, patchId } = await p.upload(await ctx.other());
        ctx.kept["ref"] = ref;
        ctx.kept["patch"] = patchId;
      },
      expected: (ctx) => ({
        "studio field": expect.objectContaining({ path: kept(ctx, "ref") }),
        "fetchVal field": draft(ctx),
        "useVal field": draft(ctx),
        "GET fetchVal field url": { status: 200, sameBytes: true },
        "GET useVal field url": { status: 200, sameBytes: true },
      }),
    },
    {
      operation: "a code change to the field's schema, after an upload",
      surfaces,
      run: async (ctx) => {
        const { ref, patchId } = await p.upload(ctx.editor);
        ctx.kept["ref"] = ref;
        ctx.kept["patch"] = patchId;
        await ctx.world.settle();
        await ctx.world.changeCode([p.changed]);
      },
      expected: (ctx) => ({
        "studio field": expect.objectContaining({ path: kept(ctx, "ref") }),
        "fetchVal field": draft(ctx),
        "useVal field": draft(ctx),
        "GET fetchVal field url": { status: 200, sameBytes: true },
        "GET useVal field url": { status: 200, sameBytes: true },
      }),
    },
  ];
}

for (const p of [plainImage(), plainFile(), plainVideo()]) {
  matrix(
    { name: p.name, config, modules: [p.module], sourceText: p.sourceText },
    plainCells(p),
  );
}

// ---------------------------------------------------------------------------
// A video library, and a field that picks from it and overrides some defaults

const VDIR = "/public/val/videos";
const V_A = `${VDIR}/a.mp4`;
const V_B = `${VDIR}/b.mp4`;
const POSTER_A = {
  path: `${VDIR}/a-poster.png`,
  width: 640,
  height: 360,
  mimeType: "image/png",
};
const videoEntries = {
  [V_A]: {
    mimeType: "video/mp4",
    width: 640,
    height: 360,
    duration: 4,
    alt: "Video A",
    poster: POSTER_A,
    posterTime: 1,
  },
  [V_B]: {
    mimeType: "video/mp4",
    width: 320,
    height: 180,
    duration: 2,
    alt: "Video B",
  },
};
const videosVal = c.define(
  "/content/videos.val.ts",
  s.videodir(VDIR, { accept: "video/*", alt: s.string().nullable() }),
  videoEntries,
);
const videosChangedVal = c.define(
  "/content/videos.val.ts",
  s.videodir(VDIR, { accept: "video/mp4", alt: s.string().nullable() }),
  videoEntries,
);
/**
 * The field overrides the library's alt and startTime; the poster and its
 * time stay the library's (`GALLERY_DEFAULT_GROUPS`: poster + posterTime are
 * one pair, every other default is its own key).
 */
const clipVal = c.define(
  "/content/clip.val.ts",
  s.object({ media: s.video(videosVal) }),
  { media: { path: V_A, alt: "The field's own alt", startTime: 2 } },
);
const videoSourceText = {
  "/content/videos.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/videos.val.ts",
  s.videodir("${VDIR}", { accept: "video/*", alt: s.string().nullable() }),
  ${JSON.stringify(videoEntries, null, 2)},
);
`,
  "/content/clip.val.ts": `import { c, s } from "../val.config";
import videosVal from "./videos.val";

export default c.define(
  "/content/clip.val.ts",
  s.object({ media: s.video(videosVal) }),
  { media: { path: "${V_A}", alt: "The field's own alt", startTime: 2 } },
);
`,
};

/** The schema a library's upload is hashed with: the one `ModuleGallery` synthesizes. */
function libraryVideoSchema(): SerializedVideoSchema {
  const root = Internal.getSchema(videosVal)?.["executeSerialize"]();
  if (root?.type !== "record") throw new Error("not a record");
  return Internal.videosetEntryVideoSchema({
    accept: root.accept,
    dir: root.dir,
  });
}

/** The library's upload, then the pick, as the field's "Upload into …" does. */
async function uploadVideoAndPick(
  studio: Studio,
): Promise<{ ref: string; patchId: PatchId }> {
  const { patch, entry } = createVideosetEntryPatch(
    {
      setPatchPath: [],
      dir: VDIR,
      filename: "new.mp4",
      upload: { kind: "file", file: uploadFile(MP4, "video/mp4") },
      metadata: { width: 640, height: 360, duration: 4 },
      remote: null,
      schema: libraryVideoSchema(),
      poster: null,
    },
    Internal.getSHA256Hash,
  );
  const patchId = await studio.write(videosVal, patch, "file");
  await studio.write(clipVal, mediaPickPatch(["media"], entry.key), "file");
  return { ref: entry.key, patchId };
}

const clip = fieldSurfaces(clipVal, MP4);
const libraryKeys: Surface = {
  kind: "server",
  name: "fetchVal library keys",
  read: async (val) => keysOf(await val.fetchVal(videosVal)),
};

const videoLibraryCells: Cell[] = [
  {
    operation: "the field's overrides over the library's defaults",
    surfaces: clip.filter((s) => s.kind !== "after"),
    run: async () => {},
    expected: () => {
      const value = expect.objectContaining({
        path: V_A,
        alt: "The field's own alt",
        startTime: 2,
        poster: expect.objectContaining({ path: POSTER_A.path }),
        posterTime: 1,
        duration: 4,
        mimeType: "video/mp4",
        url: publishedUrl(V_A),
      });
      return {
        "studio field": {
          path: V_A,
          alt: "The field's own alt",
          startTime: 2,
        },
        "fetchVal field": value,
        "useVal field": value,
      };
    },
  },
  {
    operation: "upload and pick",
    surfaces: [...clip, libraryKeys],
    run: async (ctx) => {
      const { ref, patchId } = await uploadVideoAndPick(ctx.editor);
      ctx.kept["ref"] = ref;
      ctx.kept["patch"] = patchId;
    },
    expected: (ctx) => {
      const value = expect.objectContaining({
        path: kept(ctx, "ref"),
        url: expect.stringContaining(`patch_id=${kept(ctx, "patch")}`),
        mimeType: "video/mp4",
        duration: 4,
      });
      return {
        "studio field": { path: kept(ctx, "ref") },
        "fetchVal field": value,
        "useVal field": value,
        "GET fetchVal field url": { status: 200, sameBytes: true },
        "GET useVal field url": { status: 200, sameBytes: true },
        "fetchVal library keys": [V_A, V_B, kept(ctx, "ref")].sort(),
      };
    },
  },
  {
    operation: "pick an entry",
    surfaces: clip.filter((s) => s.kind !== "after"),
    run: async (ctx) => {
      await ctx.editor.write(clipVal, mediaPickPatch(["media"], V_B), "file");
    },
    expected: () => {
      const value = expect.objectContaining({
        path: V_B,
        alt: "Video B",
        duration: 2,
        url: publishedUrl(V_B),
      });
      return {
        "studio field": { path: V_B },
        "fetchVal field": value,
        "useVal field": value,
      };
    },
  },
  {
    operation: "a new default poster in the library",
    surfaces: clip.filter((s) => s.kind !== "after"),
    run: async (ctx) => {
      const poster = uploadFile(PNG_1x1, "image/png");
      const patchId = await ctx.editor.write(
        videosVal,
        createPosterPatch({
          patchPath: [V_A],
          dir: VDIR,
          videoPath: V_A,
          poster: { ...poster, width: 1, height: 1 },
          posterTime: 3,
          remote: null,
          schema: libraryVideoSchema(),
        }),
        "image",
      );
      ctx.kept["patch"] = patchId;
    },
    expected: (ctx) => {
      // The field keeps its own startTime (2) and alt; the poster and its time are the library's new ones.
      const value = expect.objectContaining({
        path: V_A,
        alt: "The field's own alt",
        startTime: 2,
        posterTime: 3,
        poster: expect.objectContaining({
          url: expect.stringContaining(`patch_id=${kept(ctx, "patch")}`),
        }),
      });
      return {
        "studio field": {
          path: V_A,
          alt: "The field's own alt",
          startTime: 2,
        },
        "fetchVal field": value,
        "useVal field": value,
      };
    },
  },
  {
    operation: "discard an upload",
    surfaces: [...clip.filter((s) => s.kind !== "after"), libraryKeys],
    neverGoesBack: false,
    run: async (ctx) => {
      const before = ctx.editor.system.patchStore.allRecords().length;
      await uploadVideoAndPick(ctx.editor);
      await ctx.world.settle();
      const mine = ctx.editor.system.patchStore
        .allRecords()
        .slice(before)
        .map((r) => r.patchId);
      await ctx.editor.discard(mine);
    },
    expected: () => ({
      "studio field": { path: V_A, alt: "The field's own alt", startTime: 2 },
      "fetchVal field": expect.objectContaining({
        path: V_A,
        url: publishedUrl(V_A),
      }),
      "useVal field": expect.objectContaining({
        path: V_A,
        url: publishedUrl(V_A),
      }),
      "fetchVal library keys": [V_A, V_B],
    }),
  },
  {
    operation: "publish an upload",
    only: {
      modes: ["fs"],
      why: "memory mode refuses to publish a local file (ValOpsMemory.uploadRemoteFiles); a hosted project's media is remote",
    },
    surfaces: [
      ...clip.filter((s) => s.kind !== "after"),
      libraryKeys,
      onDisk(MP4),
    ],
    run: async (ctx) => {
      const { ref } = await uploadVideoAndPick(ctx.editor);
      ctx.kept["ref"] = ref;
      await ctx.world.settle();
      ctx.kept["publish"] = (await ctx.editor.publish()).status;
    },
    expected: (ctx) => {
      const value = expect.objectContaining({
        path: kept(ctx, "ref"),
        url: publishedUrl(kept(ctx, "ref")),
      });
      return {
        "studio field": { path: kept(ctx, "ref") },
        "fetchVal field": value,
        "useVal field": value,
        "fetchVal library keys": [V_A, V_B, kept(ctx, "ref")].sort(),
        "file on disk": true,
      };
    },
  },
  {
    operation: "another editor's upload, via /stat",
    surfaces: [...clip, libraryKeys],
    run: async (ctx) => {
      const { ref, patchId } = await uploadVideoAndPick(await ctx.other());
      ctx.kept["ref"] = ref;
      ctx.kept["patch"] = patchId;
    },
    expected: (ctx) => {
      const value = expect.objectContaining({
        path: kept(ctx, "ref"),
        url: expect.stringContaining(`patch_id=${kept(ctx, "patch")}`),
      });
      return {
        "studio field": { path: kept(ctx, "ref") },
        "fetchVal field": value,
        "useVal field": value,
        "GET fetchVal field url": { status: 200, sameBytes: true },
        "GET useVal field url": { status: 200, sameBytes: true },
        "fetchVal library keys": [V_A, V_B, kept(ctx, "ref")].sort(),
      };
    },
  },
  {
    operation: "a code change to the library's options",
    surfaces: clip.filter((s) => s.kind !== "after"),
    run: async (ctx) => {
      await ctx.world.changeCode([videosChangedVal, clipVal]);
    },
    expected: () => {
      const value = expect.objectContaining({
        path: V_A,
        alt: "The field's own alt",
        startTime: 2,
        url: publishedUrl(V_A),
      });
      return {
        "studio field": {
          path: V_A,
          alt: "The field's own alt",
          startTime: 2,
        },
        "fetchVal field": value,
        "useVal field": value,
      };
    },
  },
];

matrix(
  {
    name: "videodir",
    config,
    modules: [videosVal, clipVal],
    sourceText: videoSourceText,
  },
  videoLibraryCells,
);
