import {
  Internal,
  initVal,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import {
  buildImageFieldPatch,
  buildImageGalleryPatch,
  buildImageRichtextPatch,
} from "./aiImageToolPatches";

const { s, c } = initVal();

function serialize(valModule: ReturnType<typeof c.define>) {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) throw new Error("Schema not found");
  const source = Internal.getSource(valModule);
  return { schema: schema as SerializedSchema, source: source as Source };
}

describe("buildImageFieldPatch", () => {
  test("smoke: builds add+file ops for a plain image field with metadata", () => {
    const { schema, source } = serialize(
      c.define("/content/page.val.ts", s.object({ hero: s.image() }), {
        hero: null as unknown as never,
      }),
    );
    const result = buildImageFieldPatch(
      {
        filePath: "/public/val/images/hero.png",
        imageKey: "session-key-abc",
        patchPath: ["hero"],
        metadata: { width: 800, height: 600, mimeType: "image/png" },
      },
      schema,
      source,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch).toEqual([
      {
        op: "add",
        path: ["hero"],
        value: {
          _ref: "/public/val/images/hero.png",
          _type: "file",
          _tag: "image",
          metadata: { width: 800, height: 600, mimeType: "image/png" },
        },
      },
      {
        op: "file",
        path: ["hero"],
        filePath: "/public/val/images/hero.png",
        value: "session-key-abc",
        remote: false,
        metadata: { width: 800, height: 600, mimeType: "image/png" },
      },
    ]);
  });

  test("returns wrong-tool when patch_path lands on an images gallery", () => {
    const { schema, source } = serialize(
      c.define(
        "/content/site.val.ts",
        s.object({
          media: s.images({
            directory: "/public/val/images",
            accept: "image/png",
          }),
        }),
        { media: {} },
      ),
    );
    const result = buildImageFieldPatch(
      {
        filePath: "/public/val/images/foo.png",
        imageKey: "session-key-abc",
        patchPath: ["media", "/public/val/images/foo.png"],
        metadata: { width: 1, height: 1, mimeType: "image/png" },
      },
      schema,
      source,
    );
    expect(result.kind).toBe("wrong-tool");
    if (result.kind !== "wrong-tool") return;
    expect(result.suggestedTool).toBe("convert_session_image_gallery");
  });
});

describe("buildImageRichtextPatch", () => {
  test("smoke: builds add+file ops with nestedFilePath for inline img", () => {
    const { schema } = serialize(
      c.define(
        "/content/article.val.ts",
        s.object({
          body: s.richtext({
            block: { h1: true },
            inline: { img: true },
          }),
        }),
        { body: [] },
      ),
    );
    const result = buildImageRichtextPatch(
      {
        filePath: "/public/val/images/inline.png",
        imageKey: "session-key-rt",
        patchPath: ["body", "0", "children", "1"],
        nestedFilePath: ["src"],
        metadata: { width: 400, height: 300, mimeType: "image/png" },
      },
      schema,
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch).toEqual([
      {
        op: "add",
        path: ["body", "0", "children", "1"],
        value: {
          tag: "img",
          src: {
            _ref: "/public/val/images/inline.png",
            _type: "file",
            _tag: "image",
            metadata: { width: 400, height: 300, mimeType: "image/png" },
          },
        },
      },
      {
        op: "file",
        path: ["body", "0", "children", "1"],
        nestedFilePath: ["src"],
        filePath: "/public/val/images/inline.png",
        value: "session-key-rt",
        remote: false,
        metadata: { width: 400, height: 300, mimeType: "image/png" },
      },
    ]);
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
