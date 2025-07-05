import { hasRemoteFileSchema } from "./hasRemoteFileSchema";
import {
  SerializedSchema,
  SerializedObjectUnionSchema,
  SourcePath,
} from "@valbuild/core";

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
});
