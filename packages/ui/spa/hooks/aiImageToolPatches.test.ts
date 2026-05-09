import {
  Internal,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import {
  buildImageGalleryPatch,
  buildRemoveImageGalleryEntryPatch,
} from "./aiImageToolPatches";

const { s, c } = initVal();

function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  const source = Internal.getSource(valModule);
  return { schema: schema as SerializedSchema, source: source as Source };
}

describe("buildRemoveImageGalleryEntryPatch", () => {
  test("smoke: builds remove+file(null) ops with file path as record key", () => {
    const { schema, source } = serialize(
      c.define(
        "/content/media.val.ts",
        s.images({ directory: "/public/val/images", accept: "image/png" }),
        {
          "/public/val/images/foo.png": {
            width: 100,
            height: 100,
            mimeType: "image/png",
            alt: null,
          },
        },
      ),
    );
    const result = buildRemoveImageGalleryEntryPatch(
      { filePath: "/public/val/images/foo.png" },
      schema,
      source,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch).toEqual([
      { op: "remove", path: ["/public/val/images/foo.png"] },
      {
        op: "file",
        path: ["/public/val/images/foo.png"],
        filePath: "/public/val/images/foo.png",
        value: null,
        remote: false,
      },
    ]);
  });

  test("returns error with available keys hint when entry is missing", () => {
    const { schema, source } = serialize(
      c.define(
        "/content/media.val.ts",
        s.images({ directory: "/public/val/images", accept: "image/png" }),
        {
          "/public/val/images/foo.png": {
            width: 1,
            height: 1,
            mimeType: "image/png",
            alt: null,
          },
        },
      ),
    );
    const result = buildRemoveImageGalleryEntryPatch(
      { filePath: "/public/val/images/missing.png" },
      schema,
      source,
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("missing.png");
    expect(result.message).toContain("/public/val/images/foo.png");
  });
});

describe("buildImageGalleryPatch", () => {
  test("smoke: builds add+file ops with file path as record key and metadata as value", () => {
    const { schema } = serialize(
      c.define(
        "/content/media.val.ts",
        s.images({ directory: "/public/val/images", accept: "image/png" }),
        {},
      ),
    );
    const result = buildImageGalleryPatch(
      {
        filePath: "/public/val/images/foo.png",
        imageKey: "session-key-gallery",
        metadata: {
          width: 1600,
          height: 900,
          mimeType: "image/png",
          alt: "demo",
        },
      },
      schema,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch).toEqual([
      {
        op: "add",
        path: ["/public/val/images/foo.png"],
        value: {
          width: 1600,
          height: 900,
          mimeType: "image/png",
          alt: "demo",
        },
      },
      {
        op: "file",
        path: ["/public/val/images/foo.png"],
        filePath: "/public/val/images/foo.png",
        value: "session-key-gallery",
        remote: false,
        metadata: {
          width: 1600,
          height: 900,
          mimeType: "image/png",
          alt: "demo",
        },
      },
    ]);
  });
});
