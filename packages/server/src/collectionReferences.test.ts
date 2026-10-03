import {
  initVal,
  Internal,
  type ModuleFilePath,
  type SourcePath,
} from "@valbuild/core";
import { applyPatch, JSONOps } from "@valbuild/core/patch";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import {
  collectionReferencePatches,
  type CollectionReferenceService,
} from "./collectionReferences";
import { currentFixHandlers, handleGalleryCheckRemote } from "./fixHandlers";
import type { SerializedModuleContent } from "./SerializedModuleContent";

/**
 * Renaming a key of a media collection — which is what `--fix` does when it
 * moves an `s.imageset().remote()` entry to Val Remote — has to rename it
 * everywhere it is named, or every field that held it names an image the
 * gallery no longer has.
 */

const { s, c } = initVal();

const IMAGES = "/content/images.val.ts" as ModuleFilePath;
const OTHER_IMAGES = "/content/other-images.val.ts" as ModuleFilePath;
const FILES = "/content/files.val.ts" as ModuleFilePath;
const PAGE = "/content/page.val.ts" as ModuleFilePath;

const OLD_IMAGE = "/public/val/images/logo_abcde.png";
const OLD_FILE = "/public/val/files/doc_12345.pdf";
const NEW_IMAGE = remoteRefOf("public/val/images/logo_abcde.png");
const NEW_FILE = remoteRefOf("public/val/files/doc_12345.pdf");
/**
 * What the Studio stores in a field when an image is uploaded THROUGH it into a
 * remote gallery: a ref, with the entry keyed by the local path inside it. It
 * is not a key, so it names the entry its local path is.
 */
const UPLOADED_THROUGH_FIELD = remoteRefOf(
  "public/val/images/logo_abcde.png",
  "9",
);
/** A ref with the same file path that IS a key: it names its own entry. */
const KEYED_REF = remoteRefOf("public/val/images/logo_abcde.png", "c");

const IMAGE_ENTRY = {
  width: 8,
  height: 8,
  mimeType: "image/png",
  alt: null,
};

function remoteRefOf(filePath: string, hashDigit = "a"): string {
  return `https://remote.val.build/file/p/pub123/b/01/v/0.0.0/h/${hashDigit.repeat(
    64,
  )}/f/${"b".repeat(12)}/p/${filePath}`;
}

function setup() {
  const imagesVal = c.define(
    IMAGES,
    s.imageset({ dir: "/public/val/images" }).remote(),
    { [OLD_IMAGE]: IMAGE_ENTRY, [KEYED_REF]: IMAGE_ENTRY },
  );
  // Another gallery holding the same key: ITS fields name ITS image.
  const otherImagesVal = c.define(
    OTHER_IMAGES,
    s.imageset({ dir: "/public/val/images" }),
    { [OLD_IMAGE]: IMAGE_ENTRY },
  );
  const filesVal = c.define(
    FILES,
    s.fileset({ dir: "/public/val/files", accept: "application/pdf" }).remote(),
    { [OLD_FILE]: { mimeType: "application/pdf" } },
  );
  const pageVal = c.define(
    PAGE,
    s.object({
      hero: s.image(imagesVal),
      cards: s.array(s.object({ image: s.image(imagesVal).nullable() })),
      body: s.richtext({ img: s.image(imagesVal), ul: true }),
      attachment: s.file(filesVal),
      unrelated: s.image(otherImagesVal),
      own: s.image().nullable(),
      uploadedThroughField: s.image(imagesVal),
      keyedRef: s.image(imagesVal),
    }),
    {
      hero: { path: OLD_IMAGE, alt: "Kept as it is" },
      cards: [{ image: null }, { image: { path: OLD_IMAGE } }],
      body: [
        {
          tag: "p",
          children: ["Before ", { tag: "img", src: { path: OLD_IMAGE } }],
        },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [
                {
                  tag: "p",
                  children: [{ tag: "img", src: { path: OLD_IMAGE } }],
                },
              ],
            },
          ],
        },
      ],
      attachment: { path: OLD_FILE },
      unrelated: { path: OLD_IMAGE },
      own: {
        path: OLD_IMAGE,
        width: 8,
        height: 8,
        mimeType: "image/png",
      },
      uploadedThroughField: { path: UPLOADED_THROUGH_FIELD },
      keyedRef: { path: KEYED_REF },
    },
  );
  const modules: Record<ModuleFilePath, Parameters<typeof contentOf>[1]> = {
    [IMAGES]: imagesVal,
    [OTHER_IMAGES]: otherImagesVal,
    [FILES]: filesVal,
    [PAGE]: pageVal,
  };
  return { pageVal, service: serviceOf(modules) };
}

type DefinedModule = Parameters<typeof Internal.getSource>[0];

/** A module as `Service.get` hands it out. */
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

function serviceOf(
  modules: Record<ModuleFilePath, DefinedModule>,
): CollectionReferenceService {
  return {
    getModuleFilePaths: () => Object.keys(modules) as ModuleFilePath[],
    get: async (moduleFilePath) =>
      contentOf(moduleFilePath, modules[moduleFilePath]),
  };
}

function apply(source: unknown, patch: Patch): JSONValue {
  const document: JSONValue = JSON.parse(JSON.stringify(source));
  const res = applyPatch(document, new JSONOps(), patch);
  if (result.isErr(res)) {
    throw new Error(String(res.error));
  }
  return res.value;
}

describe("collectionReferencePatches", () => {
  test("points every field of the gallery, and every rich text image from it, at the new key", async () => {
    const { pageVal, service } = setup();

    const patches = await collectionReferencePatches(service, IMAGES, {
      [OLD_IMAGE]: NEW_IMAGE,
    });

    expect(patches).toEqual([
      {
        moduleFilePath: PAGE,
        patch: [
          { op: "add", path: ["hero", "path"], value: NEW_IMAGE },
          {
            op: "add",
            path: ["cards", "1", "image", "path"],
            value: NEW_IMAGE,
          },
          {
            op: "add",
            path: ["body", "0", "children", "1", "src", "path"],
            value: NEW_IMAGE,
          },
          {
            op: "add",
            path: [
              "body",
              "1",
              "children",
              "0",
              "children",
              "0",
              "children",
              "0",
              "src",
              "path",
            ],
            value: NEW_IMAGE,
          },
          {
            op: "add",
            path: ["uploadedThroughField", "path"],
            value: NEW_IMAGE,
          },
        ],
      },
    ]);
    const after = apply(Internal.getSource(pageVal), patches[0].patch);
    // One op on `path` each: what sits beside it is someone's, and stays.
    expect(after).toMatchObject({
      hero: { path: NEW_IMAGE, alt: "Kept as it is" },
      cards: [{ image: null }, { image: { path: NEW_IMAGE } }],
      // Not this gallery's fields, even where the string is the same.
      unrelated: { path: OLD_IMAGE },
      own: { path: OLD_IMAGE },
      // A key of its own: the exact key wins over the local path inside it.
      keyedRef: { path: KEYED_REF },
    });
  });

  test("a file collection's fields follow its key too", async () => {
    const { service } = setup();
    expect(
      await collectionReferencePatches(service, FILES, {
        [OLD_FILE]: NEW_FILE,
      }),
    ).toEqual([
      {
        moduleFilePath: PAGE,
        patch: [{ op: "add", path: ["attachment", "path"], value: NEW_FILE }],
      },
    ]);
  });

  test("nothing to rewrite when no field names the key", async () => {
    const { service } = setup();
    expect(
      await collectionReferencePatches(service, IMAGES, {
        "/public/val/images/nobody_00000.png": NEW_IMAGE,
      }),
    ).toEqual([]);
  });
});

describe("images:check-remote / files:check-remote", () => {
  test("are reported as core says them, not handed to createFixPatch and dropped", async () => {
    // What `validateMediaKey` emits for a ref in a gallery that is not
    // `.remote()`: a finding, not a "go and look".
    const imagesVal = c.define(
      IMAGES,
      s.imageset({ dir: "/public/val/images" }),
      { [NEW_IMAGE]: IMAGE_ENTRY },
    );
    const errors = Internal.getSchema(imagesVal)?.["executeValidate"](
      IMAGES as string as SourcePath,
      Internal.getSource(imagesVal),
    );
    const keyError = Object.values(errors || {})
      .flat()
      .find((e) => e.fixes?.includes("images:check-remote"));
    if (!keyError) throw new Error("expected an images:check-remote error");

    expect(currentFixHandlers["images:check-remote"]).toBe(
      handleGalleryCheckRemote,
    );
    expect(currentFixHandlers["files:check-remote"]).toBe(
      handleGalleryCheckRemote,
    );
    expect(
      await handleGalleryCheckRemote({ validationError: keyError }),
    ).toEqual({
      success: false,
      errorMessage: expect.stringContaining("Remote URLs are not allowed"),
    });
  });
});
