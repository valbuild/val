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
 * `val validate` over a project with `s.imageset().remote()` and
 * `s.fileset().remote()` collections, and a page that picks from them — as a
 * field, and as an image inside rich text. End to end: module loading, the fix
 * handlers, the patches and the `.val.ts` rewrite.
 */

const BASIC_FIXTURE = path.resolve(__dirname, "__fixtures__/basic");

// An 8x8 solid-colour PNG, so the metadata extractor has real bytes to read.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX/AAD//" +
    "/+l2Z/dAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB9oIBRELLnJqTAAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==",
  "base64",
);

const LOGO = "/public/val/images/logo_abcde.png";
/**
 * What the Studio stores in a field when an image is uploaded through it into
 * a remote gallery: a ref, while the gallery keys the entry by the local path
 * inside it (here, LOGO).
 */
const LOGO_UPLOADED_THROUGH_FIELD = `https://remote.val.build/file/p/pubproj/b/01/v/0.0.0/h/${"c".repeat(
  64,
)}/f/${"d".repeat(12)}/p${LOGO}`;
const DOC = "/public/val/files/doc_12345.pdf";

const PROJECT: Record<string, string> = {
  "val.modules.ts": `import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/images.val") },
  { def: () => import("./content/files.val") },
  { def: () => import("./content/page.val") },
  { def: () => import("./content/cards.val") },
  { def: () => import("./content/local-images.val") },
  { def: () => import("./content/remote-image.val") },
]);
`,
  "content/images.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/images.val.ts",
  s.imageset({ dir: "/public/val/images" }).remote(),
  {
    "${LOGO}": { width: 8, height: 8, mimeType: "image/png", alt: "Logo" },
  },
);
`,
  "content/files.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/files.val.ts",
  s.fileset({ dir: "/public/val/files", accept: "application/pdf" }).remote(),
  {
    "${DOC}": { mimeType: "application/pdf" },
  },
);
`,
  // A field inside a `.jsonValues()` entry: its value is in the entry's
  // `*.val.json`, which is where the rename has to land.
  "content/cards.val.ts": `import { c, s } from "../val.config";
import imagesVal from "./images.val";

export default c.define(
  "/content/cards.val.ts",
  s.record(s.object({ image: s.image(imagesVal) })).jsonValues(),
  {
    "/a": c.json(() => import("./cards/a.val.json")),
  },
);
`,
  "content/cards/a.val.json": JSON.stringify({ image: { path: LOGO } }),
  "content/page.val.ts": `import { c, s } from "../val.config";
import imagesVal from "./images.val";
import filesVal from "./files.val";

export default c.define(
  "/content/page.val.ts",
  s.object({
    hero: s.image(imagesVal),
    card: s.image(imagesVal),
    body: s.richtext({ img: s.image(imagesVal) }),
    attachment: s.file(filesVal),
  }),
  {
    hero: { path: "${LOGO}", alt: "Kept" },
    card: { path: "${LOGO_UPLOADED_THROUGH_FIELD}" },
    body: [
      {
        tag: "p",
        children: ["Look: ", { tag: "img", src: { path: "${LOGO}" } }],
      },
    ],
    attachment: { path: "${DOC}" },
  },
);
`,
  // Not \`.remote()\`, and keyed by a ref anyway: an error for a person.
  "content/local-images.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/local-images.val.ts",
  s.imageset({ dir: "/public/val/local" }),
  {
    "https://remote.val.build/file/p/pubproj/b/01/v/0.0.0/h/${"a".repeat(64)}/f/${"b".repeat(12)}/p/public/val/local/x_00000.png":
      { width: 8, height: 8, mimeType: "image/png", alt: null },
  },
);
`,
  // A field of its own, not from a gallery, with a ref that does not parse.
  "content/remote-image.val.ts": `import { c, s } from "../val.config";

export default c.define(
  "/content/remote-image.val.ts",
  s.image().remote(),
  { path: "https://remote.val.build/file/not-a-ref.png", width: 8, height: 8, mimeType: "image/png" },
);
`,
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

function errorsOf(events: ValidationEvent[]) {
  return events.filter(
    (e) =>
      e.type === "validation-error" || e.type === "validation-fixable-error",
  );
}

describe("val validate with remote image and file collections", () => {
  let root: string;

  beforeEach(() => {
    const tmpBase = path.join(__dirname, ".tmp");
    fs.mkdirSync(tmpBase, { recursive: true });
    root = fs.mkdtempSync(path.join(tmpBase, "imageset-"));
    for (const file of ["val.config.ts", "tsconfig.json"]) {
      fs.copyFileSync(path.join(BASIC_FIXTURE, file), path.join(root, file));
    }
    const files: Record<string, string | Buffer> = {
      ...PROJECT,
      [LOGO.slice(1)]: PNG,
      [DOC.slice(1)]: "%PDF-1.4\n",
      "public/val/local/x_00000.png": PNG,
    };
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("--fix uploads the entries, renames their keys, and points the page's field and rich text image at them", async () => {
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
    const modules = [
      "content/cards.val.ts",
      "content/files.val.ts",
      "content/images.val.ts",
      "content/page.val.ts",
    ];
    // Before: the page is valid against both collections, and the two
    // entries are fixable.
    expect(
      errorsOf(await run(root, modules, false)).map((e) => e.sourcePath),
    ).toEqual([
      `/content/files.val.ts?p="${DOC}"`,
      `/content/images.val.ts?p="${LOGO}"`,
    ]);

    await run(root, modules, true, remote);
    expect(uploaded).toHaveLength(2);

    const images = await sourceOf(root, "/content/images.val.ts");
    const [logoRef] = Object.keys(images ?? {});
    expect(logoRef).toMatch(
      /^https:\/\/.*pubproj.*public\/val\/images\/logo_abcde\.png$/,
    );
    const files = await sourceOf(root, "/content/files.val.ts");
    const [docRef] = Object.keys(files ?? {});
    expect(docRef).toMatch(
      /^https:\/\/.*pubproj.*public\/val\/files\/doc_12345\.pdf$/,
    );
    expect(await sourceOf(root, "/content/page.val.ts")).toEqual({
      hero: { path: logoRef, alt: "Kept" },
      card: { path: logoRef },
      body: [
        {
          tag: "p",
          children: ["Look: ", { tag: "img", src: { path: logoRef } }],
        },
      ],
      attachment: { path: docRef },
    });
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, "content/cards/a.val.json"), "utf-8"),
      ),
    ).toEqual({ image: { path: logoRef } });

    // And all of them are valid against each other afterwards.
    const again = await run(root, modules, false);
    expect(errorsOf(again)).toEqual([]);
    expect(again.at(-1)).toEqual({ type: "summary-success" });
  });

  describe("a key that is wrong as a key", () => {
    test("is reported with what core says, and the module is not valid", async () => {
      const events = await run(root, ["content/local-images.val.ts"], false);
      expect(errorsOf(events)).toEqual([
        expect.objectContaining({
          type: "validation-error",
          message: expect.stringContaining("Remote URLs are not allowed"),
          keyError: true,
        }),
      ]);
      expect(events.filter((e) => e.type === "file-valid")).toEqual([]);
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
    });

    test("--fix leaves it to a person, and still reports it", async () => {
      const before = fs.readFileSync(
        path.join(root, "content/local-images.val.ts"),
        "utf-8",
      );
      const events = await run(root, ["content/local-images.val.ts"], true);
      expect(errorsOf(events)).toEqual([
        expect.objectContaining({
          type: "validation-error",
          message: expect.stringContaining("Remote URLs are not allowed"),
        }),
      ]);
      expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
      expect(
        fs.readFileSync(
          path.join(root, "content/local-images.val.ts"),
          "utf-8",
        ),
      ).toBe(before);
    });
  });

  /**
   * The singular `image:check-remote` is core's "was not checked" marker, put
   * on every remote image whether or not it is wrong. It stays a hand-off to
   * `createFixPatch`, which checks the ref and reports only what is wrong —
   * this pins that the hand-off does report it.
   */
  test("a field's malformed remote ref is still reported, through the check createFixPatch makes", async () => {
    const events = await run(root, ["content/remote-image.val.ts"], false);
    expect(errorsOf(events)).toEqual([
      expect.objectContaining({
        sourcePath: "/content/remote-image.val.ts",
        message: expect.stringContaining("not-a-ref.png"),
      }),
    ]);
    expect(events.at(-1)).toEqual({ type: "summary-errors", count: 1 });
  });
});
