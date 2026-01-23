import { findRequiredRemoteFiles } from "./findRequiredRemoteFiles";
import { SerializedSchema, SourcePath } from "@valbuild/core";

describe("findRequiredRemoteFiles", () => {
  it("should return true for a file schema with remote set to true", () => {
    const schema: SerializedSchema = { type: "file", remote: true, opt: false };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for a file schema with remote set to false", () => {
    const schema: SerializedSchema = {
      type: "file",
      remote: false,
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for an image schema with remote set to true", () => {
    const schema: SerializedSchema = {
      type: "image",
      remote: true,
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for an image schema with remote set to false", () => {
    const schema: SerializedSchema = {
      type: "image",
      remote: false,
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for a richtext schema with remote inline image", () => {
    const schema: SerializedSchema = {
      type: "richtext",
      options: { inline: { img: { type: "image", remote: true, opt: false } } },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for a richtext schema without remote inline image", () => {
    const schema: SerializedSchema = {
      type: "richtext",
      options: {
        inline: { img: { type: "image", remote: false, opt: false } },
      },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for an array schema with a remote file item", () => {
    const schema: SerializedSchema = {
      type: "array",
      item: { type: "file", remote: true, opt: false },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for an array schema without a remote file item", () => {
    const schema: SerializedSchema = {
      type: "array",
      item: { type: "file", remote: false, opt: false },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for a record schema with a remote file item", () => {
    const schema: SerializedSchema = {
      type: "record",
      item: { type: "file", remote: true, opt: false },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for a record schema without a remote file item", () => {
    const schema: SerializedSchema = {
      type: "record",
      item: { type: "file", remote: false, opt: false },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for a union schema with at least one remote file item", () => {
    const schema: SerializedSchema = {
      type: "union",
      key: "key",
      items: [
        {
          type: "object",
          items: {
            key: { type: "string", raw: false, opt: false },
            test: { type: "file", remote: true, opt: false },
          },
          opt: false,
        },
      ],
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for a union schema without any remote file items", () => {
    const schema: SerializedSchema = {
      type: "union",
      key: "key",
      items: [
        {
          type: "object",
          items: {
            key: { type: "string", raw: false, opt: false },
            test: { type: "file", remote: false, opt: false },
          },
          opt: false,
        },
      ],
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return true for an object schema with at least one remote file item", () => {
    const schema: SerializedSchema = {
      type: "object",
      items: {
        key: { type: "string", raw: false, opt: false },
        test: {
          type: "object",
          items: {
            key: { type: "string", raw: false, opt: false },
            test: { type: "file", remote: true, opt: false },
          },
          opt: false,
        },
      },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(true);
  });

  it("should return false for an object schema without any remote file items", () => {
    const schema: SerializedSchema = {
      type: "object",
      items: {
        key1: { type: "file", remote: false, opt: false },
        key2: { type: "image", remote: false, opt: false },
      },
      opt: false,
    };
    expect(findRequiredRemoteFiles(schema)).toBe(false);
  });

  it("should return false for primitive types like boolean, number, string, etc.", () => {
    const primitiveSchemas: SerializedSchema[] = [
      { type: "boolean", opt: false },
      { type: "number", opt: false },
      { type: "string", raw: false, opt: false },
      { type: "date", opt: false },
      {
        type: "keyOf",
        path: "" as SourcePath,
        opt: false,
        schema: {
          type: "record",
          opt: false,
        },
        values: [""],
      },
      { type: "literal", opt: false, value: "test" },
    ];
    for (const schema of primitiveSchemas) {
      expect(findRequiredRemoteFiles(schema)).toBe(false);
    }
  });

  it("should log an error and return false for an unexpected schema type", () => {
    const schema = { type: "unknown" } as unknown as SerializedSchema;
    console.error = jest.fn();
    expect(findRequiredRemoteFiles(schema)).toBe(null);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("unexpected schema type"),
      schema,
    );
  });
});
