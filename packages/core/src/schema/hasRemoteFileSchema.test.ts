import { hasRemoteFileSchema } from "./hasRemoteFileSchema";
import { initVal } from "../initVal";
import { Schema, type SerializedSchema } from "./index";
import type { SelectorSource } from "../selector";
import type { SerializedObjectUnionSchema } from "./union";
import type { SourcePath } from "../val";

const { s } = initVal();

/**
 * Serialize a schema the way the callers get it.
 *
 * Both of them read `SerializedSchema`, never a `Schema`: the server out of
 * `getSchemas()`, the Studio out of `host.receive`. Building the fixtures with
 * `s` and serializing is what makes the media-collection tests below mean
 * anything — the bug they cover was a walk that did not match the shape
 * `s.images()` actually produces, and a hand-written fixture would have agreed
 * with the walk rather than with the schema.
 */
function serialize<T extends SelectorSource>(
  schema: Schema<T>,
): SerializedSchema {
  // Bracket access, as everywhere else that serializes a schema: the method is
  // protected, and element access with a string literal is how the rest of the
  // codebase reaches it.
  return schema["executeSerialize"]();
}

describe("hasRemoteFileSchema", () => {
  it("should return true for a file schema with remote set to true", () => {
    const schema: SerializedSchema = { type: "file", opt: false, remote: true };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for a file schema with remote set to false", () => {
    const schema: SerializedSchema = {
      type: "file",
      opt: false,
      remote: false,
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for an image schema with remote set to true", () => {
    const schema: SerializedSchema = {
      type: "image",
      opt: false,
      remote: true,
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for an image schema with remote set to false", () => {
    const schema: SerializedSchema = {
      type: "image",
      opt: false,
      remote: false,
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return false for a richtext schema whose inline image is not remote", () => {
    const schema: SerializedSchema = {
      type: "richtext",
      opt: false,
      options: {
        inline: { img: { type: "image", opt: false, remote: false } },
      },
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return false for a richtext schema without inline image options", () => {
    const schema: SerializedSchema = {
      type: "richtext",
      opt: false,
      options: {},
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for a richtext schema with inline image having remote set to true", () => {
    const schema: SerializedSchema = {
      type: "richtext",
      opt: false,
      options: { inline: { img: { type: "image", opt: false, remote: true } } },
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for an array schema with no remote files", () => {
    const schema: SerializedSchema = {
      type: "array",
      opt: false,
      item: { type: "string", raw: false, opt: false },
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for an array schema with a remote file", () => {
    const schema: SerializedSchema = {
      type: "array",
      opt: false,
      item: { type: "file", opt: false, remote: true },
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for an array schema whose file item is not remote", () => {
    const schema: SerializedSchema = {
      type: "array",
      opt: false,
      item: { type: "file", opt: false, remote: false },
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for a record schema whose item is a remote file", () => {
    const schema: SerializedSchema = {
      type: "record",
      opt: false,
      item: { type: "file", opt: false, remote: true },
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for a record schema whose item is not remote", () => {
    const schema: SerializedSchema = {
      type: "record",
      opt: false,
      item: { type: "file", opt: false, remote: false },
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for a remote file nested two objects deep", () => {
    const schema: SerializedSchema = {
      type: "object",
      opt: false,
      items: {
        key: { type: "string", raw: false, opt: false },
        inner: {
          type: "object",
          opt: false,
          items: {
            key: { type: "string", raw: false, opt: false },
            photo: { type: "file", opt: false, remote: true },
          },
        },
      },
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for an object whose media fields are all local", () => {
    const schema: SerializedSchema = {
      type: "object",
      opt: false,
      items: {
        key1: { type: "file", opt: false, remote: false },
        key2: { type: "image", opt: false, remote: false },
      },
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for an object schema with a remote file in its items", () => {
    const schema: SerializedSchema = {
      type: "object",
      opt: false,
      items: {
        key1: { type: "string", raw: false, opt: false },
        key2: { type: "file", opt: false, remote: true },
      },
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for a union schema with no remote files", () => {
    const schema: SerializedObjectUnionSchema = {
      type: "union",
      opt: false,
      key: "type",
      items: [
        {
          type: "object",
          opt: false,
          items: {
            type: { type: "literal", opt: false, value: "type1" },
            key1: { type: "string", raw: false, opt: false },
            key2: { type: "number", opt: false },
          },
        },
        {
          type: "object",
          opt: false,
          items: {
            type: { type: "literal", opt: false, value: "type2" },
            key3: { type: "string", raw: false, opt: false },
            key4: { type: "number", opt: false },
          },
        },
      ],
    };
    expect(hasRemoteFileSchema(schema)).toBe(false);
  });

  it("should return true for a union schema with a remote file", () => {
    const schema: SerializedObjectUnionSchema = {
      type: "union",
      opt: false,
      key: "type",
      items: [
        {
          type: "object",
          opt: false,
          items: {
            type: { type: "literal", opt: false, value: "type1" },
            key1: { type: "string", raw: false, opt: false },
            key2: { type: "number", opt: false },
          },
        },
        {
          type: "object",
          opt: false,
          items: {
            type: { type: "literal", opt: false, value: "type2" },
            key3: { type: "file", opt: false, remote: true },
            key4: { type: "number", opt: false },
          },
        },
      ],
    };
    expect(hasRemoteFileSchema(schema)).toBe(true);
  });

  it("should return false for primitive types like boolean, number, string, etc.", () => {
    const primitiveSchemas: SerializedSchema[] = [
      { type: "boolean", opt: false },
      { type: "number", opt: false },
      { type: "string", raw: false, opt: false },
      { type: "literal", opt: false, value: "test" },
      { type: "date", opt: false },
      {
        type: "keyOf",
        opt: false,
        values: ["test1", "test2"],
        path: "/test.val.ts" as SourcePath,
        schema: {
          type: "record",
          opt: false,
        },
      },
    ];
    for (const schema of primitiveSchemas) {
      expect(hasRemoteFileSchema(schema)).toBe(false);
    }
  });

  it("should throw an error for an unexpected schema type", () => {
    const schema = {
      type: "unknown",
      opt: false,
    } as unknown as SerializedSchema;
    expect(() => hasRemoteFileSchema(schema)).toThrow(
      'Unexpected schema: {"type":"unknown","opt":false}',
    );
  });

  /**
   * Media collections, which is where the two old implementations disagreed.
   *
   * `s.images()` / `s.files()` serialize as a `record` whose item is an object of
   * metadata — there is no file or image schema inside to find, because the file
   * is named by the record's KEY. So a walk that only recurses into `item` says
   * no, and the server's copy did exactly that.
   *
   * Getting this wrong is silent: with `false`, `/save` runs `saveOrUploadFiles`
   * in `skip-remote` mode, which drops every remote descriptor without an error,
   * and the commit lands a remote ref with no bytes behind it.
   */
  describe("media collections", () => {
    it("should return true for s.images({ remote: true })", () => {
      expect(hasRemoteFileSchema(serialize(s.images({ remote: true })))).toBe(
        true,
      );
    });

    it("should return true for a remote s.files()", () => {
      // `accept` is required on `s.files()` (unlike `s.images()`, whose options
      // are all optional), so it is here to satisfy the type, not the test.
      expect(
        hasRemoteFileSchema(
          serialize(s.files({ accept: "application/pdf", remote: true })),
        ),
      ).toBe(true);
    });

    it("should return false for a local s.images()", () => {
      expect(hasRemoteFileSchema(serialize(s.images()))).toBe(false);
    });

    it("should return false for a local s.files()", () => {
      expect(
        hasRemoteFileSchema(serialize(s.files({ accept: "application/pdf" }))),
      ).toBe(false);
    });

    it("should return false for s.images({ remote: false })", () => {
      expect(hasRemoteFileSchema(serialize(s.images({ remote: false })))).toBe(
        false,
      );
    });

    it("should find a remote gallery nested in an object", () => {
      expect(
        hasRemoteFileSchema(
          serialize(
            s.object({
              title: s.string(),
              gallery: s.images({ remote: true }),
            }),
          ),
        ),
      ).toBe(true);
    });

    it("should find a remote gallery nested in a union", () => {
      expect(
        hasRemoteFileSchema(
          serialize(
            s.union(
              "type",
              s.object({
                type: s.literal("text"),
                text: s.string(),
              }),
              s.object({
                type: s.literal("images"),
                images: s.images({ remote: true }),
              }),
            ),
          ),
        ),
      ).toBe(true);
    });

    it("should still look inside a plain record for a remote field", () => {
      // Not a media collection: an ordinary record whose ITEM holds the remote
      // image. The `mediaType` shortcut must not stop the walk here.
      expect(
        hasRemoteFileSchema(
          serialize(s.record(s.object({ photo: s.image().remote() }))),
        ),
      ).toBe(true);
    });

    it("should return false for a plain record of strings", () => {
      expect(hasRemoteFileSchema(serialize(s.record(s.string())))).toBe(false);
    });
  });
});
