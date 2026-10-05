import { initVal } from "./initVal";
import { ImageSchema } from "./schema/image";
import type { ImageSource } from "./source/media";
import { Schema, type SerializedSchema } from "./schema";
import type { SelectorSource } from "./selector";
import type { SourcePath } from "./val";

/**
 * `files: { remote: true }` in `val.config.ts` makes every media schema
 * remote. These tests read what the rest of Val reads -- the serialized schema
 * and the validation errors -- because that is the whole of what the setting is
 * for: nothing downstream knows it exists.
 */
function mediaSchemasOf(remote: boolean) {
  const { s, c } = initVal(remote ? { files: { remote: true } } : undefined);
  const images = c.define(
    "/content/images.val.ts",
    s.imageset({ dir: "/public/val/images" }),
    {},
  );
  const files = c.define(
    "/content/files.val.ts",
    s.fileset({ accept: "application/pdf", dir: "/public/val/files" }),
    {},
  );
  const videos = c.define(
    "/content/videos.val.ts",
    s.videoset({ dir: "/public/val/videos" }),
    {},
  );
  const schemas: Record<string, { serialize: () => SerializedSchema }> = {
    image: forSerialize(s.image()),
    file: forSerialize(s.file()),
    video: forSerialize(s.video()),
    imageset: forSerialize(s.imageset({ dir: "/public/val/images" })),
    fileset: forSerialize(
      s.fileset({ accept: "application/pdf", dir: "/public/val/files" }),
    ),
    videoset: forSerialize(s.videoset({ dir: "/public/val/videos" })),
    "image(gallery)": forSerialize(s.image(images)),
    "file(gallery)": forSerialize(s.file(files)),
    "video(gallery)": forSerialize(s.video(videos)),
  };
  return schemas;
}

function forSerialize<T extends SelectorSource>(schema: Schema<T>) {
  return { serialize: () => schema["executeSerialize"]() };
}

function remoteOf(serialized: SerializedSchema): boolean | undefined {
  if (
    serialized.type === "image" ||
    serialized.type === "file" ||
    serialized.type === "video" ||
    serialized.type === "record"
  ) {
    return serialized.remote;
  }
  throw new Error(`Not a media schema: ${serialized.type}`);
}

describe("files.remote", () => {
  test("without it, every media schema is local", () => {
    for (const [name, schema] of Object.entries(mediaSchemasOf(false))) {
      expect([name, remoteOf(schema.serialize())]).toEqual([name, false]);
    }
  });

  test("with it, every media schema is remote", () => {
    for (const [name, schema] of Object.entries(mediaSchemasOf(true))) {
      expect([name, remoteOf(schema.serialize())]).toEqual([name, true]);
    }
  });

  test("it is the same schema as one written with .remote()", () => {
    const { s: local } = initVal();
    const { s: remote } = initVal({ files: { remote: true } });
    expect(
      remote.image({ accept: "image/webp" })["executeSerialize"](),
    ).toEqual(
      local.image({ accept: "image/webp" }).remote()["executeSerialize"](),
    );
    expect(remote.video()["executeSerialize"]()).toEqual(
      local.video().remote()["executeSerialize"](),
    );
    // And .remote() on top of it changes nothing.
    expect(remote.file().remote()["executeSerialize"]()).toEqual(
      remote.file()["executeSerialize"](),
    );
  });

  test("the types do not change", () => {
    const { s } = initVal({ files: { remote: true } });
    const image: ImageSchema<ImageSource> = s.image();
    expect(image).toBeInstanceOf(ImageSchema);
  });

  test("a local image is a validation error, fixed by uploading it", () => {
    const { s } = initVal({ files: { remote: true } });
    const result = s
      .image()
      ["executeValidate"]("/content/page.val.ts" as SourcePath, {
        path: "/public/val/logo.png",
        width: 100,
        height: 100,
        mimeType: "image/png",
      });
    expect(result).toEqual({
      "/content/page.val.ts": [
        expect.objectContaining({
          message: "Expected a remote image, but got a local image.",
          fixes: ["image:upload-remote"],
        }),
      ],
    });
  });

  describe("richtext", () => {
    test("img: true is a remote image", () => {
      const { s } = initVal({ files: { remote: true } });
      const serialized = s.richtext({ img: true })["executeSerialize"]();
      expect(serialized.type === "richtext" && serialized.options?.img).toEqual(
        expect.objectContaining({ type: "image", remote: true }),
      );
    });

    test("img: true stays `true` without the setting", () => {
      const { s } = initVal();
      const serialized = s.richtext({ img: true })["executeSerialize"]();
      expect(serialized.type === "richtext" && serialized.options?.img).toBe(
        true,
      );
    });

    test("a local inline image is a validation error", () => {
      const { s } = initVal({ files: { remote: true } });
      const schema = s.richtext({ img: true });
      const result = schema["executeValidate"](
        "/content/page.val.ts" as SourcePath,
        [
          {
            tag: "p",
            children: [
              {
                tag: "img",
                src: {
                  path: "/public/val/inline.png",
                  width: 1,
                  height: 1,
                  mimeType: "image/png",
                },
              },
            ],
          },
        ],
      );
      expect(JSON.stringify(result)).toContain("image:upload-remote");
    });
  });
});
