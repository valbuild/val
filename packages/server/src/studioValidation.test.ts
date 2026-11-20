import fs from "fs";
import os from "os";
import path from "path";
import {
  initVal,
  ModuleFilePath,
  SourcePath,
  ValModules,
} from "@valbuild/core";
import { ValOpsFS } from "./ValOpsFS";
import { checkModuleForStudio, fixForStudio } from "./studioValidation";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
  "base64",
);

const PAGE = "/content/page.val.ts" as ModuleFilePath;
const OTHER = "/content/other.val.ts" as ModuleFilePath;

/**
 * The Studio's full check against a real `ValOpsFS` over a project on disk:
 * the same `validateSources` → `validateFiles` → `createFixPatch` path the
 * route runs, with real bytes behind the images.
 */
describe("the Studio's full check", () => {
  const { s, c, config } = initVal();
  let root: string;

  const setup = (
    page: Record<string, unknown>,
    Ops: typeof ValOpsFS = ValOpsFS,
  ) => {
    const valModules: ValModules = {
      config,
      modules: [
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                PAGE,
                s.object({
                  title: s.string(),
                  hero: s.image(),
                  doc: s.file().nullable(),
                }),
                // Typed by the schema when written inline; built per test here.
                page as never,
              ),
            }),
        },
        {
          def: () =>
            Promise.resolve({
              default: c.define(OTHER, s.string().minLength(10), "short"),
            }),
        },
      ],
    };
    const ops = new Ops("http://localhost:4000", root, valModules, {
      config,
    });
    return ops;
  };

  const sourcesOf = async (ops: ValOpsFS) => {
    const schemas = await ops.getSchemas();
    const { sources } = await ops.getSources();
    return { schemas, sources, fileLastUpdatedByPatchId: {} };
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-check-"));
    fs.mkdirSync(path.join(root, "public/val"), { recursive: true });
    fs.writeFileSync(path.join(root, "public/val/hero.png"), PNG);
    fs.writeFileSync(path.join(root, "public/val/doc.pdf"), "%PDF-1.4");
    for (const module of [PAGE, OTHER]) {
      fs.mkdirSync(path.dirname(path.join(root, module)), { recursive: true });
      fs.writeFileSync(path.join(root, module), "");
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("an image whose metadata does not match its bytes is reported at the field", async () => {
    const ops = setup({
      title: "Hello",
      hero: {
        path: "/public/val/hero.png",
        width: 8,
        height: 8,
        mimeType: "image/png",
      },
      doc: null,
    });
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      ...(await sourcesOf(ops)),
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(Object.keys(res.errors).sort()).toEqual([
      `${PAGE}?p="hero"."height"`,
      `${PAGE}?p="hero"."width"`,
    ]);
  });

  test("an image whose metadata is right is not reported at all", async () => {
    // `ImageSchema` flags every image with metadata as "not checked against
    // the file". That must never reach the page as an error of its own.
    const ops = setup({
      title: "Hello",
      hero: {
        path: "/public/val/hero.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
      doc: null,
    });
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      ...(await sourcesOf(ops)),
    });
    expect(res).toEqual({ status: "ok", errors: {}, remoteHosts: [] });
  });

  test("in a hosted project, a published file it cannot read is not judged", async () => {
    // No repository: a template's files are in the built site, so the check
    // has nothing to read them from (`ValOps.canReadPublishedFiles`).
    class HostedOps extends ValOpsFS {
      override canReadPublishedFiles(): boolean {
        return false;
      }
    }
    fs.rmSync(path.join(root, "public/val/hero.png"));
    const page = {
      title: "Hello",
      hero: {
        path: "/public/val/hero.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
      doc: null,
    };
    const fsOps = setup(page);
    const local = await checkModuleForStudio(fsOps, {
      moduleFilePath: PAGE,
      ...(await sourcesOf(fsOps)),
    });
    // Where the file can be read, a missing one is still found.
    expect(local.status).toBe("ok");
    if (local.status !== "ok") return;
    expect(Object.keys(local.errors)).not.toEqual([]);
    const hostedOps = setup(page, HostedOps);
    expect(
      await checkModuleForStudio(hostedOps, {
        moduleFilePath: PAGE,
        ...(await sourcesOf(hostedOps)),
      }),
    ).toEqual({ status: "ok", errors: {}, remoteHosts: [] });
  });

  test("only the module asked about is checked", async () => {
    const ops = setup({
      title: "Hello",
      hero: {
        path: "/public/val/hero.png",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
      doc: null,
    });
    const page = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      ...(await sourcesOf(ops)),
    });
    const other = await checkModuleForStudio(ops, {
      moduleFilePath: OTHER,
      ...(await sourcesOf(ops)),
    });
    expect(page).toEqual({ status: "ok", errors: {}, remoteHosts: [] });
    expect(other.status).toBe("ok");
    if (other.status !== "ok") return;
    expect(Object.keys(other.errors)).toEqual([OTHER]);
  });

  test("a module that does not exist is said to be unknown", async () => {
    const ops = setup({
      title: "Hello",
      hero: { path: "/public/val/hero.png" },
      doc: null,
    });
    expect(
      await checkModuleForStudio(ops, {
        moduleFilePath: "/content/nope.val.ts" as ModuleFilePath,
        ...(await sourcesOf(ops)),
      }),
    ).toEqual({ status: "unknown-module" });
  });

  describe("fixes", () => {
    test("a wrong width, named at the field, is fixed at the image", async () => {
      const ops = setup({
        title: "Hello",
        hero: {
          path: "/public/val/hero.png",
          width: 8,
          height: 8,
          mimeType: "image/png",
        },
        doc: null,
      });
      const res = await fixForStudio(ops, {
        moduleFilePath: PAGE,
        ...(await sourcesOf(ops)),
        sourcePath: `${PAGE}?p="hero"."width"` as SourcePath,
        fix: "image:check-metadata",
      });
      expect(res).toEqual({
        status: "ok",
        patch: [
          { op: "add", path: ["hero", "width"], value: 1 },
          { op: "add", path: ["hero", "height"], value: 1 },
        ],
        remainingErrors: [],
      });
    });

    test("missing metadata is read from the file", async () => {
      const ops = setup({
        title: "Hello",
        hero: { path: "/public/val/hero.png" },
        doc: null,
      });
      const res = await fixForStudio(ops, {
        moduleFilePath: PAGE,
        ...(await sourcesOf(ops)),
        sourcePath: `${PAGE}?p="hero"` as SourcePath,
        fix: "image:add-metadata",
      });
      expect(res).toEqual({
        status: "ok",
        patch: [
          { op: "add", path: ["hero", "width"], value: 1 },
          { op: "add", path: ["hero", "height"], value: 1 },
          { op: "add", path: ["hero", "mimeType"], value: "image/png" },
        ],
        remainingErrors: [],
      });
    });

    test("a file whose mime type does not match its extension is reported, with nothing to fix", async () => {
      // `FileSchema` decides this before any byte is read, and offers no fix:
      // which of the two is wrong is not something the server can know. The
      // Studio shows it with **Open**, not **Fix**.
      const ops = setup({
        title: "Hello",
        hero: {
          path: "/public/val/hero.png",
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
        doc: { path: "/public/val/doc.pdf", mimeType: "image/png" },
      });
      const check = await checkModuleForStudio(ops, {
        moduleFilePath: PAGE,
        ...(await sourcesOf(ops)),
      });
      expect(check).toEqual({
        status: "ok",
        errors: {
          [`${PAGE}?p="doc"`]: [
            expect.objectContaining({
              message: expect.stringContaining("file extension"),
            }),
          ],
        },
        remoteHosts: [],
      });
      if (check.status === "ok") {
        const docPath = `${PAGE}?p="doc"` as SourcePath;
        expect(check.errors[docPath]?.[0]?.fixes).toBeUndefined();
      }
    });

    test("an error that is no longer there is not fixed", async () => {
      const ops = setup({
        title: "Hello",
        hero: {
          path: "/public/val/hero.png",
          width: 1,
          height: 1,
          mimeType: "image/png",
        },
        doc: null,
      });
      expect(
        await fixForStudio(ops, {
          moduleFilePath: PAGE,
          ...(await sourcesOf(ops)),
          sourcePath: `${PAGE}?p="hero"."width"` as SourcePath,
          fix: "image:check-metadata",
        }),
      ).toEqual({ status: "not-found" });
    });

    test("a fix that needs a disk or a remote host is refused, not attempted", async () => {
      const ops = setup({
        title: "Hello",
        hero: { path: "/public/val/hero.png" },
        doc: null,
      });
      expect(
        await fixForStudio(ops, {
          moduleFilePath: PAGE,
          ...(await sourcesOf(ops)),
          sourcePath: `${PAGE}?p="hero"` as SourcePath,
          fix: "image:upload-remote",
        }),
      ).toEqual({ status: "not-in-studio" });
    });
  });
});

/**
 * A `.jsonValues()` record's entries get the same project-wide resolution as
 * every other module. Their errors used to be added raw, so every keyOf and
 * route in such a record read as unresolved -- 240 bogus errors in
 * `examples/next`'s kb.val.ts -- and every image in an entry as "not checked
 * against the file".
 */
describe("the full check on a .jsonValues() record", () => {
  const { s, c, config } = initVal();
  const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
  const POSTS = "/content/posts.val.ts" as ModuleFilePath;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-jsonvalues-"));
    for (const module of [AUTHORS, POSTS]) {
      fs.mkdirSync(path.dirname(path.join(root, module)), { recursive: true });
      fs.writeFileSync(path.join(root, module), "");
    }
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a valid keyOf in an entry is not an error, and a wrong one is", async () => {
    const authorsVal = c.define(AUTHORS, s.record(s.string()), {
      kari: "Kari",
    });
    const valModules: ValModules = {
      config,
      modules: [
        { def: () => Promise.resolve({ default: authorsVal }) },
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                POSTS,
                s
                  .record(
                    s.object({
                      title: s.string(),
                      author: s.keyOf(authorsVal),
                    }),
                  )
                  .jsonValues(),
                {
                  "/a": c.json(() =>
                    Promise.resolve({
                      default: { title: "A", author: "kari" },
                    }),
                  ),
                  "/b": c.json(() =>
                    Promise.resolve({
                      default: { title: "B", author: "nobody" },
                    }),
                  ),
                },
              ),
            }),
        },
      ],
    };
    const ops = new ValOpsFS("http://localhost:4000", root, valModules, {
      config,
    });
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: POSTS,
      schemas: await ops.getSchemas(),
      sources: (await ops.getSources()).sources,
      fileLastUpdatedByPatchId: {},
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const paths = Object.keys(res.errors);
    expect(paths.some((p) => p.includes('"/a"'))).toBe(false);
    expect(paths.some((p) => p.includes('"/b"'))).toBe(true);
  });

  test("a remote image in an entry is not a row the Studio cannot fix", async () => {
    const ref =
      "https://remote.val.build/file/p/pubproj/b/01/v/0.0.0/h/" +
      "c".repeat(64) +
      "/f/" +
      "d".repeat(12) +
      "/p/public/val/a.png";
    const valModules: ValModules = {
      config,
      modules: [
        {
          def: () =>
            Promise.resolve({
              default: c.define(
                POSTS,
                s
                  .record(
                    s.object({ title: s.string(), hero: s.image().remote() }),
                  )
                  .jsonValues(),
                {
                  "/a": c.json(() =>
                    Promise.resolve({
                      default: {
                        title: "A",
                        hero: {
                          path: ref,
                          width: 8,
                          height: 8,
                          mimeType: "image/png",
                        },
                      },
                    }),
                  ),
                },
              ),
            }),
        },
      ],
    };
    const ops = new ValOpsFS("http://localhost:4000", root, valModules, {
      config,
    });
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: POSTS,
      schemas: await ops.getSchemas(),
      sources: (await ops.getSources()).sources,
      fileLastUpdatedByPatchId: {},
    });
    expect(res.status === "ok" && res.errors).toEqual({});
  });
});
