import {
  Internal,
  initVal,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  galleryAltPatch,
  galleryRef,
  galleryRemovePatch,
  galleryUploadPatch,
} from "../../packages/ui/spa/components/fields/galleryPatches";
import { mediaPickPatch } from "../../packages/ui/spa/components/fields/mediaPickPatch";
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
 * The matrix for media libraries -- `s.imagedir` and `s.filedir` -- and a
 * field that picks from each (`s.image(imagesVal)`, `s.file(filesVal)`).
 *
 * A library entry carries no URL: it is a record keyed by the file's path,
 * holding what is true of the file. The URL is the field's, filled from the
 * library when the field is read (`fillFromGallery`). So each cell checks the
 * entry's metadata on every surface, and the picking field's path, URL and
 * filled metadata, and whether the URL serves the bytes.
 *
 * An upload is what the field's "Upload into …" does: the library's upload
 * (`galleryRef`, `galleryUploadPatch`, written and uploaded the way a field
 * writes it), then the pick (`mediaPickPatch`). What the browser does before
 * that -- `FileReader` and `Image` decoding the file into a data URL, its
 * SHA-256 and its size -- is the environment's, and is given here.
 */

const { s, c, config } = initVal({});
type AnyModule = ValModule<SelectorSource>;

/**
 * Why cells fail today. Each is a bug: the user expects every one of these to
 * work. Evidence and suspected cause are in the README's matrix section.
 */
const L1 =
  "L1: the page's server render gives a field that picked a library entry uploaded in a pending patch the PUBLISHED url (no patch_id), so the server-rendered page names a file that does not exist yet; the overlay's hook gives the draft url";

/** What a library shape needs: its modules, its upload, and its expectations. */
type Library = {
  name: string;
  kind: "image" | "file";
  dir: string;
  library: AnyModule;
  field: AnyModule;
  /** The same library with an option added: a code change. */
  changedLibrary: AnyModule;
  A: string;
  B: string;
  entries: Record<string, Record<string, unknown>>;
  upload: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
    width?: number;
    height?: number;
  };
  sourceText: Record<string, string>;
};

const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (ch) => ch.charCodeAt(0),
);

function imageLibrary(): Library {
  const dir = "/public/val/images";
  const A = `${dir}/a.png`;
  const B = `${dir}/b.png`;
  const entries = {
    [A]: { width: 10, height: 10, mimeType: "image/png", alt: "Alt A" },
    [B]: { width: 20, height: 20, mimeType: "image/png", alt: "Alt B" },
  };
  const library = c.define(
    "/content/images.val.ts",
    s.imagedir(dir, { alt: s.string().nullable() }),
    entries,
  );
  const changedLibrary = c.define(
    "/content/images.val.ts",
    // What the library accepts, narrowed: a change to the library's schema.
    s.imagedir(dir, { alt: s.string().nullable(), accept: "image/png" }),
    entries,
  );
  const field = c.define(
    "/content/hero.val.ts",
    s.object({ media: s.image(library) }),
    { media: { path: A } },
  );
  return {
    name: "imagedir",
    kind: "image",
    dir,
    library,
    field,
    changedLibrary,
    A,
    B,
    entries,
    upload: {
      bytes: PNG_1x1,
      filename: "new.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
    },
    sourceText: {
      "/content/images.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/images.val.ts",
  s.imagedir("${dir}", { alt: s.string().nullable() }),
  {
    "${A}": { width: 10, height: 10, mimeType: "image/png", alt: "Alt A" },
    "${B}": { width: 20, height: 20, mimeType: "image/png", alt: "Alt B" },
  },
);
`,
      "/content/hero.val.ts": `import { c, s } from "../val.config";
import imagesVal from "./images.val";

export default c.define(
  "/content/hero.val.ts",
  s.object({ media: s.image(imagesVal) }),
  { media: { path: "${A}" } },
);
`,
    },
  };
}

function fileLibrary(): Library {
  const dir = "/public/val/docs";
  const A = `${dir}/a.pdf`;
  const B = `${dir}/b.pdf`;
  const entries = {
    [A]: { mimeType: "application/pdf" },
    [B]: { mimeType: "application/pdf" },
  };
  const library = c.define(
    "/content/docs.val.ts",
    s.filedir(dir, { accept: "application/*" }),
    entries,
  );
  const changedLibrary = c.define(
    "/content/docs.val.ts",
    // What the library accepts, narrowed: a change to the library's schema.
    s.filedir(dir, { accept: "application/pdf" }),
    entries,
  );
  const field = c.define(
    "/content/download.val.ts",
    s.object({ media: s.file(library) }),
    { media: { path: A } },
  );
  return {
    name: "filedir",
    kind: "file",
    dir,
    library,
    field,
    changedLibrary,
    A,
    B,
    entries,
    upload: {
      bytes: new TextEncoder().encode("%PDF-1.4 a test file"),
      filename: "new.pdf",
      mimeType: "application/pdf",
    },
    sourceText: {
      "/content/docs.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/docs.val.ts",
  s.filedir("${dir}", { accept: "application/*" }),
  {
    "${A}": { mimeType: "application/pdf" },
    "${B}": { mimeType: "application/pdf" },
  },
);
`,
      "/content/download.val.ts": `import { c, s } from "../val.config";
import docsVal from "./docs.val";

export default c.define(
  "/content/download.val.ts",
  s.object({ media: s.file(docsVal) }),
  { media: { path: "${A}" } },
);
`,
    },
  };
}

/** What `readImage` / `readFile` resolve to for these bytes: the browser's part. */
function readUpload(lib: Library) {
  const { bytes, filename, mimeType } = lib.upload;
  return {
    src: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    fileHash: Internal.getSHA256Hash(bytes),
    filename,
  };
}

/** The library's upload and then the pick, as the field's "Upload into …" does. */
async function uploadAndPick(
  lib: Library,
  studio: Studio,
): Promise<{ ref: string; patchId: string }> {
  const read = readUpload(lib);
  const metadata =
    lib.kind === "image"
      ? {
          width: lib.upload.width ?? 0,
          height: lib.upload.height ?? 0,
          mimeType: lib.upload.mimeType,
        }
      : { mimeType: lib.upload.mimeType };
  const refRes = galleryRef(
    { directory: lib.dir, requireRemote: false, remoteData: null },
    read,
    lib.kind === "image"
      ? { type: "image", opt: false }
      : { type: "file", opt: false },
    metadata,
  );
  if (refRes.status === "error") throw new Error(refRes.error);
  const patch = galleryUploadPatch({
    patchPath: [],
    ref: refRes.ref,
    src: read.src,
    remote: false,
    media:
      lib.kind === "image"
        ? {
            kind: "image",
            metadata: {
              width: lib.upload.width ?? 0,
              height: lib.upload.height ?? 0,
              mimeType: lib.upload.mimeType,
            },
          }
        : { kind: "file", metadata: { mimeType: lib.upload.mimeType } },
  });
  const patchId = await studio.write(lib.library, patch, lib.kind);
  await studio.write(
    lib.field,
    mediaPickPatch(["media"], refRes.ref),
    lib.kind,
  );
  return { ref: refRes.ref, patchId };
}

function cellsFor(lib: Library): Cell[] {
  /** The field's value on every surface. */
  const field: Surface[] = [
    {
      kind: "studio",
      name: "studio field",
      module: lib.field,
      field: ["media"],
    },
    {
      kind: "server",
      name: "fetchVal field",
      read: async (val) => fieldOf(await val.fetchVal(lib.field), ["media"]),
    },
    { kind: "hook", name: "useVal field", module: lib.field, field: ["media"] },
  ];
  /** One entry of the library on every surface. */
  const entry = (name: string, ref: () => string): Surface[] => [
    {
      kind: "after",
      name: `studio entry ${name}`,
      read: async (ctx) => studioValue(ctx, lib.library, [ref()]),
    },
    {
      kind: "server",
      name: `fetchVal entry ${name}`,
      read: async (val) => fieldOf(await val.fetchVal(lib.library), [ref()]),
    },
  ];
  const keys: Surface[] = [
    {
      kind: "server",
      name: "fetchVal library keys",
      read: async (val) => keysOf(await val.fetchVal(lib.library)),
    },
  ];
  /** Whether the field's URL, as `surfaceName` gives it, serves the uploaded bytes. */
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
        sameBytes: Buffer.from(body).equals(Buffer.from(lib.upload.bytes)),
      };
    },
  });
  const served = [servedBy("fetchVal field"), servedBy("useVal field")];
  /** The ref the cell's upload made, for the entry surfaces read before it is known. */
  const uploaded = { ref: "" };
  const uploadedRef = (ctx: CellContext) => kept(ctx, "ref");
  const metaOf = (ref: string, extra: Record<string, unknown> = {}) => ({
    ...(lib.entries[ref] ?? {}),
    ...extra,
  });
  const uploadedMeta =
    lib.kind === "image"
      ? {
          width: lib.upload.width,
          height: lib.upload.height,
          mimeType: lib.upload.mimeType,
          alt: null,
        }
      : { mimeType: lib.upload.mimeType };
  const publishedUrl = (ref: string) => ref.replace(/^\/public/, "");

  return [
    {
      operation: "upload and pick",
      failing: { "fetchVal field": L1, "GET fetchVal field url": L1 },
      surfaces: [
        ...field,
        ...entry("new", () => uploaded.ref),
        ...keys,
        ...served,
      ],
      run: async (ctx) => {
        const { ref, patchId } = await uploadAndPick(lib, ctx.editor);
        ctx.kept["ref"] = ref;
        ctx.kept["patch"] = patchId;
        uploaded.ref = ref;
      },
      expected: (ctx) => {
        const ref = uploadedRef(ctx);
        const patchId = kept(ctx, "patch");
        const fieldValue = expect.objectContaining({
          path: ref,
          url: expect.stringContaining(`patch_id=${patchId}`),
          mimeType: lib.upload.mimeType,
        });
        return {
          "studio field": { path: ref },
          "fetchVal field": fieldValue,
          "useVal field": fieldValue,
          "studio entry new": expect.objectContaining(uploadedMeta),
          "fetchVal entry new": expect.objectContaining(uploadedMeta),
          "fetchVal library keys": [lib.A, lib.B, ref].sort(),
          "GET fetchVal field url": { status: 200, sameBytes: true },
          "GET useVal field url": { status: 200, sameBytes: true },
        };
      },
    },
    ...(lib.kind === "image"
      ? [
          {
            operation: "edit an entry's alt text",
            surfaces: [...field, ...entry("A", () => lib.A)],
            run: async (ctx: CellContext) => {
              await ctx.editor.write(
                lib.library,
                galleryAltPatch([], lib.A, "New alt"),
              );
            },
            expected: () => ({
              "studio field": { path: lib.A },
              "fetchVal field": expect.objectContaining({
                path: lib.A,
                alt: "New alt",
                url: publishedUrl(lib.A),
              }),
              "useVal field": expect.objectContaining({
                path: lib.A,
                alt: "New alt",
                url: publishedUrl(lib.A),
              }),
              "studio entry A": metaOf(lib.A, { alt: "New alt" }),
              "fetchVal entry A": metaOf(lib.A, { alt: "New alt" }),
            }),
          } satisfies Cell,
        ]
      : []),
    {
      operation: "pick an entry",
      surfaces: field,
      run: async (ctx) => {
        await ctx.editor.write(
          lib.field,
          mediaPickPatch(["media"], lib.B),
          lib.kind,
        );
      },
      expected: () => ({
        "studio field": { path: lib.B },
        "fetchVal field": {
          path: lib.B,
          ...metaOf(lib.B),
          url: publishedUrl(lib.B),
        },
        "useVal field": {
          path: lib.B,
          ...metaOf(lib.B),
          url: publishedUrl(lib.B),
        },
      }),
    },
    {
      operation: "delete an unused entry",
      surfaces: [...entry("B", () => lib.B), ...keys],
      run: async (ctx) => {
        await ctx.editor.write(
          lib.library,
          galleryRemovePatch({
            patchPath: [],
            ref: lib.B,
            filePaths: [lib.B],
            remote: false,
            entryFiles: [],
          }),
          lib.kind,
        );
      },
      expected: () => ({
        "studio entry B": "(absent)",
        "fetchVal entry B": undefined,
        "fetchVal library keys": [lib.A],
      }),
    },
    {
      operation: "discard an upload",
      surfaces: [...field, ...keys],
      neverGoesBack: false,
      run: async (ctx) => {
        const before = ctx.editor.system.patchStore.allRecords().length;
        await uploadAndPick(lib, ctx.editor);
        await ctx.world.settle();
        const mine = ctx.editor.system.patchStore
          .allRecords()
          .slice(before)
          .map((r) => r.patchId);
        await ctx.editor.discard(mine);
      },
      expected: () => ({
        "studio field": { path: lib.A },
        "fetchVal field": {
          path: lib.A,
          ...metaOf(lib.A),
          url: publishedUrl(lib.A),
        },
        "useVal field": {
          path: lib.A,
          ...metaOf(lib.A),
          url: publishedUrl(lib.A),
        },
        "fetchVal library keys": [lib.A, lib.B],
      }),
    },
    {
      operation: "publish an upload",
      only: {
        modes: ["fs"],
        why: "memory mode refuses to publish a local file (ValOpsMemory.uploadRemoteFiles); a hosted project's media is remote",
      },
      surfaces: [
        ...field,
        ...keys,
        {
          kind: "after",
          name: "file on disk",
          read: async (ctx) => {
            if (ctx.world.server.mode !== "fs") return "(memory)";
            const file = join(ctx.world.server.root, kept(ctx, "ref"));
            try {
              return Buffer.from(readFileSync(file)).equals(
                Buffer.from(lib.upload.bytes),
              );
            } catch {
              return "(missing)";
            }
          },
        },
        {
          kind: "after",
          name: "source text names the file",
          read: async (ctx) => {
            if (ctx.world.server.mode !== "fs") return "(memory)";
            const [libraryPath] = Object.keys(lib.sourceText);
            const text = readFileSync(
              join(ctx.world.server.root, libraryPath ?? ""),
              "utf8",
            );
            return text.includes(kept(ctx, "ref"));
          },
        },
      ],
      run: async (ctx) => {
        const { ref } = await uploadAndPick(lib, ctx.editor);
        ctx.kept["ref"] = ref;
        await ctx.world.settle();
        const published = await ctx.editor.publish();
        ctx.kept["publish"] = published.status;
      },
      expected: (ctx) => {
        const ref = uploadedRef(ctx);
        const fieldValue = expect.objectContaining({
          path: ref,
          url: publishedUrl(ref),
        });
        return {
          "studio field": { path: ref },
          "fetchVal field": fieldValue,
          "useVal field": fieldValue,
          "fetchVal library keys": [lib.A, lib.B, ref].sort(),
          "file on disk": true,
          "source text names the file": true,
        };
      },
    },
    {
      operation: "another editor's upload, via /stat",
      failing: { "fetchVal field": L1 },
      surfaces: [...field, ...keys],
      run: async (ctx) => {
        const other = await ctx.other();
        const { ref, patchId } = await uploadAndPick(lib, other);
        ctx.kept["ref"] = ref;
        ctx.kept["patch"] = patchId;
      },
      expected: (ctx) => {
        const ref = uploadedRef(ctx);
        const fieldValue = expect.objectContaining({
          path: ref,
          url: expect.stringContaining(`patch_id=${kept(ctx, "patch")}`),
        });
        return {
          "studio field": { path: ref },
          "fetchVal field": fieldValue,
          "useVal field": fieldValue,
          "fetchVal library keys": [lib.A, lib.B, ref].sort(),
        };
      },
    },
    {
      operation: "a code change to the library's options",
      surfaces: field,
      run: async (ctx) => {
        await ctx.world.changeCode([lib.changedLibrary, lib.field]);
      },
      expected: () => ({
        "studio field": { path: lib.A },
        "fetchVal field": expect.objectContaining({
          path: lib.A,
          url: publishedUrl(lib.A),
          mimeType: metaOf(lib.A)["mimeType"],
        }),
        "useVal field": expect.objectContaining({
          path: lib.A,
          url: publishedUrl(lib.A),
          mimeType: metaOf(lib.A)["mimeType"],
        }),
      }),
    },
  ];
}

async function studioValue(
  ctx: CellContext,
  module: AnyModule,
  field: string[],
) {
  let path = Internal.getValPath(module);
  for (const key of field) path = Internal.createValPathOfItem(path, key);
  if (path === undefined) throw new Error("no path");
  const read = await ctx.editor.system.sourceStore.get(path, null);
  return "data" in read ? read.data : `(${read.status})`;
}

for (const lib of [imageLibrary(), fileLibrary()]) {
  matrix(
    {
      name: lib.name,
      config,
      modules: [lib.library, lib.field],
      sourceText: lib.sourceText,
    },
    cellsFor(lib),
  );
}
