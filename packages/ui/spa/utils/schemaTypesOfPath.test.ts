import { initVal } from "@valbuild/core";
import { schemaTypesOfPath } from "./schemaTypesOfPath";

const { s } = initVal();
describe("schemaTypesOfPath", () => {
  test("empty module path", () => {
    const schema = s.string();
    const patchPath: string[] = [];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string"]));
  });

  test("basic object with string", () => {
    const schema = s.object({ prop1: s.string() });
    const patchPath = ["prop1"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string"]));
  });

  test("basic record", () => {
    const schema = s.record(s.object({ prop1: s.string() }));
    const patchPath = ["test", "prop1"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string"]));
  });

  test("basic array", () => {
    const schema = s.object({ prop1: s.array(s.object({ test: s.string() })) });
    const patchPath = ["prop1", "0", "test"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string"]));
  });

  test("enum: 1", () => {
    const schema = s.object({
      test: s.enum("type1", "type2"),
    });
    const patchPath = ["test"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string", "enum"]));
  });

  test("discriminated union: 1", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({ type: s.literal("string"), value: s.string() }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["value"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string", "number"]));
  });

  test("discriminated union: 2", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1") }),
          s.object({ test: s.literal("type2"), innerNumber: s.number() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["object", "discriminated-union"]));
  });

  test("discriminated union: 3", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1") }),
          s.object({ test: s.literal("type2"), innerNumber: s.number() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner", "innerNumber"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["number"]));
  });

  test("discriminated union: 4", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1"), innerValue: s.string() }),
          s.object({ test: s.literal("type2"), innerValue: s.number() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner", "innerValue"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["number", "string"]));
  });

  test("discriminated union: 5", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1"), innerValue: s.string() }),
          s.object({ test: s.literal("type2"), innerValue: s.number() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner", "innerValue"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["number", "string"]));
  });

  test("discriminated union: 6", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1"), innerValue: s.string() }),
          s.object({ test: s.literal("type2"), innerValue: s.string() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner", "innerValue"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["string"]));
  });

  test("discriminated union: 7", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({ test: s.literal("type1"), innerValue: s.string() }),
          s.object({ test: s.literal("type2"), innerValue: s.string() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["value"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["number"]));
  });

  test("discriminated union: 8", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({
        type: s.literal("string"),
        inner: s.discriminatedUnion(
          "test",
          s.object({
            test: s.literal("type1"),
            innerValue: s.object({ test: s.string() }),
          }),
          s.object({ test: s.literal("type2"), innerValue: s.number() }),
        ),
      }),
      s.object({ type: s.literal("number"), value: s.number() }),
    );
    const patchPath = ["inner", "innerValue"];
    const res = schemaTypesOfPath(schema["executeSerialize"](), patchPath);
    expect(res).toEqual(new Set(["object", "number"]));
  });
});
