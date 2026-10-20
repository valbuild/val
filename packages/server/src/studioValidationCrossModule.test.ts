import fs from "fs";
import os from "os";
import path from "path";
import { initVal, ModuleFilePath, ValModules } from "@valbuild/core";
import { ValOpsFS } from "./ValOpsFS";
import { checkModuleForStudio } from "./studioValidation";

const AUTHORS = "/content/authors.val.ts" as ModuleFilePath;
const IMAGES = "/content/images.val.ts" as ModuleFilePath;
const PAGE = "/content/page.val.ts" as ModuleFilePath;

/**
 * A field that points into another module -- a `s.keyOf()` key, an image
 * picked from a gallery -- is checked against that module's CURRENT source,
 * which no single module's schema can see (`SCHEMA_SOURCE_FIXES`). The
 * Studio's full check has to answer those the way the publish gate does, or
 * every such field reads as an error on the Validate page.
 */
describe("the Studio's full check, across modules", () => {
  const { s, c, config } = initVal();
  let root: string;

  const authorsVal = c.define(
    AUTHORS,
    s.record(s.object({ name: s.string() })),
    {
      ada: { name: "Ada" },
    },
  );
  const imagesVal = c.define(IMAGES, s.imagedir("/public/val/images", {}), {
    "/public/val/images/a.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  });
  const pageVal = c.define(
    PAGE,
    s.object({ author: s.keyOf(authorsVal), hero: s.image(imagesVal) }),
    {
      author: "ada",
      hero: { path: "/public/val/images/a.png" },
    },
  );

  const setup = () => {
    const valModules: ValModules = {
      config,
      modules: [authorsVal, imagesVal, pageVal].map((module) => ({
        def: () => Promise.resolve({ default: module }),
      })),
    };
    return new ValOpsFS("http://localhost:4000", root, valModules, { config });
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "val-studio-cross-"));
    for (const module of [AUTHORS, IMAGES, PAGE]) {
      fs.mkdirSync(path.dirname(path.join(root, module)), { recursive: true });
      fs.writeFileSync(path.join(root, module), "");
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a key that its record has is not an error", async () => {
    const ops = setup();
    const schemas = await ops.getSchemas();
    const { sources } = await ops.getSources();
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      schemas,
      sources,
      fileLastUpdatedByPatchId: {},
    });
    expect(res.status === "ok" && res.errors).toEqual({});
  });

  test("an image added to the gallery since its schema was evaluated is not an error", async () => {
    const ops = setup();
    const schemas = await ops.getSchemas();
    const { sources } = await ops.getSources();
    const NEW = "/public/val/images/new_9e87d.png";
    // As a pending upload leaves them: the gallery has the entry, the page
    // points at it, and the schema's copy of the gallery is the one built.
    const current = {
      ...sources,
      [IMAGES]: {
        ...(sources[IMAGES] as object),
        [NEW]: { width: 1, height: 1, mimeType: "image/png", alt: null },
      },
      [PAGE]: { author: "ada", hero: { path: NEW } },
    };
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      schemas,
      sources: current,
      fileLastUpdatedByPatchId: {},
    });
    expect(res.status === "ok" && res.errors).toEqual({});
  });

  test("a key its record does not have is still an error", async () => {
    const ops = setup();
    const schemas = await ops.getSchemas();
    const { sources } = await ops.getSources();
    const res = await checkModuleForStudio(ops, {
      moduleFilePath: PAGE,
      schemas,
      sources: {
        ...sources,
        [PAGE]: {
          author: "nobody",
          hero: { path: "/public/val/images/a.png" },
        },
      },
      fileLastUpdatedByPatchId: {},
    });
    expect(res.status).toBe("ok");
    const messages =
      res.status === "ok"
        ? Object.values(res.errors).flatMap((errors) =>
            errors.map((error) => ({
              message: error.message,
              fixes: error.fixes ?? [],
            })),
          )
        : [];
    expect(messages).toHaveLength(1);
    // Reported as a plain error, not as a marker the Studio cannot act on.
    expect(messages[0]?.fixes).toEqual([]);
  });
});
