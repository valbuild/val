import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  STUDIO_STATIC_ROUTE,
  assetsRev,
  loadReplacement,
  replacementFor,
  studioAssetsOf,
  type StudioFound,
} from "./studioAssets";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const EMBEDDED = "THE EMBEDDED STUDIO";

/**
 * A project with an installed `@valbuild/ui`, shaped as the real one is:
 * `./server` exported, and -- unless `withStatic` is false -- the Studio as
 * files beside it.
 */
async function project(
  options: {
    withStatic?: boolean;
    files?: Record<string, string>;
    manifest?: (manifest: Record<string, unknown>) => Record<string, unknown>;
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "studio-assets-"));
  const ui = join(dir, "node_modules", "@valbuild", "ui");
  await mkdir(join(ui, "server"), { recursive: true });
  await writeFile(
    join(ui, "package.json"),
    JSON.stringify({
      name: "@valbuild/ui",
      version: "1.2.3",
      exports: { "./server": "./server/index.js" },
    }),
  );
  await writeFile(
    join(ui, "server", "index.js"),
    `export function createUIRequestHandler() { return ${JSON.stringify(EMBEDDED)}; }\n`,
  );
  const files = options.files ?? {
    "/assets/index-abc.js": "console.log('main')",
    "/assets/index-abc.css": "body{}",
    "/index.html": "<html></html>",
  };
  if (options.withStatic !== false) {
    for (const [file, text] of Object.entries(files)) {
      const at = join(ui, "static", "files", file);
      await mkdir(join(at, ".."), { recursive: true });
      await writeFile(at, text);
    }
    const manifest = {
      format: 1,
      version: "1.2.3",
      files: Object.fromEntries(
        Object.entries(files).map(([file, text]) => [
          file,
          {
            sha256: sha(text),
            size: text.length,
            contentType: file.endsWith(".html")
              ? "text/html; charset=utf-8"
              : file.endsWith(".css")
                ? "text/css"
                : "application/javascript",
          },
        ]),
      ),
      routes: {
        "/assets/index-abc.js": {
          file: "/assets/index-abc.js",
          cacheControl: "immutable",
        },
        "/1.2.3/app": {
          file: "/assets/index-abc.js",
          cacheControl: "immutable",
        },
        "/1.2.3/spa/index.css": {
          file: "/assets/index-abc.css",
          cacheControl: "immutable",
        },
      },
      fallback: { file: "/index.html", cacheControl: "max-age=90" },
    };
    await writeFile(
      join(ui, "static", "manifest.json"),
      JSON.stringify(options.manifest ? options.manifest(manifest) : manifest),
    );
  }
  return { dir, ui };
}

const made: string[] = [];
afterAll(async () => {
  await Promise.all(
    made.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/*
 * The plugin's decision, as `resolveId` makes it once rolldown has resolved
 * `@valbuild/ui/server` for the importer. jest cannot load rolldown (it is
 * ESM-only), so the hook is tested through the function it delegates to.
 */
describe("replacementFor", () => {
  test("replaces a @valbuild/ui/server that ships its files, and says which", async () => {
    const { dir, ui } = await project();
    made.push(dir);
    const found: StudioFound = { root: null };
    const id = replacementFor(found, { id: join(ui, "server", "index.js") });
    expect(id).not.toBeNull();
    expect(found.root).toBe(ui);
    const source = loadReplacement(id!);
    expect(source).toContain("export function createUIRequestHandler");
    expect(source).toContain("served by the platform");
    expect(source).not.toContain(EMBEDDED);
  });

  test("leaves a @valbuild/ui from before static/ alone", async () => {
    const { dir, ui } = await project({ withStatic: false });
    made.push(dir);
    const found: StudioFound = { root: null };
    expect(
      replacementFor(found, { id: join(ui, "server", "index.js") }),
    ).toBeNull();
    expect(found.root).toBeNull();
  });

  test("leaves an external or unresolved import alone", () => {
    const found: StudioFound = { root: null };
    expect(replacementFor(found, null)).toBeNull();
    expect(
      replacementFor(found, { id: "@valbuild/ui/server", external: true }),
    ).toBeNull();
  });

  test("refuses two different copies of @valbuild/ui in one layer", async () => {
    const one = await project();
    const two = await project();
    made.push(one.dir, two.dir);
    const found: StudioFound = { root: null };
    replacementFor(found, { id: join(one.ui, "server", "index.js") });
    expect(() =>
      replacementFor(found, { id: join(two.ui, "server", "index.js") }),
    ).toThrow(/Two copies of @valbuild\/ui/);
  });
});

describe("studioAssetsOf", () => {
  test("maps every route under the static route, with the bytes by hash", async () => {
    const { dir, ui } = await project();
    made.push(dir);
    const { assets, files, version } = await studioAssetsOf(ui);
    expect(version).toBe("1.2.3");
    expect(Object.keys(assets.paths).sort()).toEqual([
      `${STUDIO_STATIC_ROUTE}/1.2.3/app`,
      `${STUDIO_STATIC_ROUTE}/1.2.3/spa/index.css`,
      `${STUDIO_STATIC_ROUTE}/assets/index-abc.js`,
    ]);
    const main = assets.paths[`${STUDIO_STATIC_ROUTE}/1.2.3/app`]!;
    expect(main).toEqual({
      sha256: sha("console.log('main')"),
      contentType: "application/javascript",
      cacheControl: "immutable",
    });
    expect(assets.fallbacks).toEqual([
      {
        prefix: `${STUDIO_STATIC_ROUTE}/`,
        sha256: sha("<html></html>"),
        contentType: "text/html; charset=utf-8",
        cacheControl: "max-age=90",
      },
    ]);
    // Every hash named has its bytes, once.
    expect(Object.keys(files).sort()).toEqual(
      [sha("console.log('main')"), sha("body{}"), sha("<html></html>")].sort(),
    );
    expect(Buffer.from(files[main.sha256]!, "base64").toString()).toBe(
      "console.log('main')",
    );
  });

  test("refuses a file that does not match its manifest", async () => {
    const { dir, ui } = await project();
    made.push(dir);
    await writeFile(
      join(ui, "static", "files", "assets", "index-abc.js"),
      "tampered",
    );
    await expect(studioAssetsOf(ui)).rejects.toThrow(/does not match/);
  });

  test("refuses a manifest format it does not know", async () => {
    const { dir, ui } = await project({
      manifest: (manifest) => ({ ...manifest, format: 2 }),
    });
    made.push(dir);
    await expect(studioAssetsOf(ui)).rejects.toThrow(/format 2/);
  });
});

describe("assetsRev", () => {
  test("changes when a file does, so a new Studio is a new layer", async () => {
    const one = await project();
    const two = await project({
      files: {
        "/assets/index-abc.js": "console.log('main, again')",
        "/assets/index-abc.css": "body{}",
        "/index.html": "<html></html>",
      },
    });
    made.push(one.dir, two.dir);
    const a = (await studioAssetsOf(one.ui)).assets;
    const b = (await studioAssetsOf(two.ui)).assets;
    expect(assetsRev(a)).not.toBe(assetsRev(b));
    expect(assetsRev(a)).toBe(assetsRev((await studioAssetsOf(one.ui)).assets));
  });
});
