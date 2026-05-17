import { ModuleFilePath, SerializedSchema, SourcePath } from "@valbuild/core";
import {
  getUnchangedSiblings,
  buildOrderedItems,
  UnchangedSibling,
} from "./getUnchangedSiblings";
import { ChangeTreeNode } from "./computeChangedSourcePaths";

const MODULE = "/app/pages.val.ts" as ModuleFilePath;

function sp(modulePath: string): SourcePath {
  return `${MODULE}?p=${modulePath}` as SourcePath;
}

function makeNode(
  sourcePath: SourcePath | ModuleFilePath,
  change?: ChangeTreeNode["change"],
): ChangeTreeNode {
  return {
    sourcePath,
    lastUpdated: "2025-01-01T00:00:00Z",
    change,
    children: [],
  };
}

const dummyChange: ChangeTreeNode["change"] = {
  changeType: "field-change",
  patchIds: ["p1" as never],
  authors: ["alice"],
  lastUpdatedBy: "alice",
  patchesByAuthorIds: {},
};

describe("getUnchangedSiblings", () => {
  describe("object schema", () => {
    const schema: SerializedSchema = {
      type: "object",
      items: {
        title: { type: "string", opt: false, raw: false },
        body: { type: "string", opt: false, raw: false },
        status: { type: "string", opt: false, raw: false },
        sections: { type: "string", opt: false, raw: false },
      },
      opt: false,
    };
    const source = {
      title: "Hello",
      body: "World",
      status: "draft",
      sections: [],
    };

    test("returns unchanged keys when some are changed", () => {
      const changed = new Set(["title", "status"]);
      const result = getUnchangedSiblings(
        sp('"home"'),
        schema,
        source,
        changed,
      );
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.key)).toEqual(["body", "sections"]);
      expect(result[0].sourcePath).toContain("?p=");
    });

    test("returns empty when all keys are changed", () => {
      const changed = new Set(["title", "body", "status", "sections"]);
      const result = getUnchangedSiblings(
        sp('"home"'),
        schema,
        source,
        changed,
      );
      expect(result).toHaveLength(0);
    });

    test("returns all keys when none are changed", () => {
      const result = getUnchangedSiblings(
        sp('"home"'),
        schema,
        source,
        new Set(),
      );
      expect(result).toHaveLength(4);
    });
  });

  describe("record schema", () => {
    const schema: SerializedSchema = {
      type: "record",
      item: { type: "string", opt: false, raw: false },
      opt: false,
    };
    const source = {
      "/home": { title: "Home" },
      "/about": { title: "About" },
      "/contact": { title: "Contact" },
    };

    test("returns unchanged record keys", () => {
      const changed = new Set(["/home"]);
      const result = getUnchangedSiblings(MODULE, schema, source, changed);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.key)).toEqual(["/about", "/contact"]);
    });
  });

  describe("array schema", () => {
    const schema: SerializedSchema = {
      type: "array",
      item: { type: "string", opt: false, raw: false },
      opt: false,
    };
    const source = ["a", "b", "c", "d", "e"];

    test("returns unchanged array indices", () => {
      const changed = new Set(["1", "3"]);
      const result = getUnchangedSiblings(
        sp('"items"'),
        schema,
        source,
        changed,
      );
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.key)).toEqual(["0", "2", "4"]);
    });

    test("returns all indices when none changed", () => {
      const result = getUnchangedSiblings(
        sp('"items"'),
        schema,
        source,
        new Set(),
      );
      expect(result).toHaveLength(5);
    });
  });

  describe("primitive / unsupported schemas", () => {
    test("string schema returns empty", () => {
      const result = getUnchangedSiblings(
        sp('"title"'),
        { type: "string", opt: false, raw: false },
        "hello",
        new Set(),
      );
      expect(result).toHaveLength(0);
    });

    test("number schema returns empty", () => {
      const result = getUnchangedSiblings(
        sp('"count"'),
        { type: "number", opt: false },
        42,
        new Set(),
      );
      expect(result).toHaveLength(0);
    });

    test("boolean schema returns empty", () => {
      const result = getUnchangedSiblings(
        sp('"flag"'),
        { type: "boolean", opt: false },
        true,
        new Set(),
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("schema/source mismatch", () => {
    test("record schema with non-object source returns empty", () => {
      const schema: SerializedSchema = {
        type: "record",
        item: { type: "string", opt: false, raw: false },
        opt: false,
      };
      const result = getUnchangedSiblings(
        MODULE,
        schema,
        "not an object",
        new Set(),
      );
      expect(result).toHaveLength(0);
    });

    test("array schema with non-array source returns empty", () => {
      const schema: SerializedSchema = {
        type: "array",
        item: { type: "string", opt: false, raw: false },
        opt: false,
      };
      const result = getUnchangedSiblings(
        sp('"items"'),
        schema,
        { not: "an array" },
        new Set(),
      );
      expect(result).toHaveLength(0);
    });

    test("record schema with null source returns empty", () => {
      const schema: SerializedSchema = {
        type: "record",
        item: { type: "string", opt: false, raw: false },
        opt: false,
      };
      const result = getUnchangedSiblings(MODULE, schema, null, new Set());
      expect(result).toHaveLength(0);
    });
  });
});

describe("buildOrderedItems", () => {
  const objectSchema: SerializedSchema = {
    type: "object",
    items: {
      title: { type: "string", opt: false, raw: false },
      body: { type: "string", opt: false, raw: false },
      status: { type: "string", opt: false, raw: false },
      sections: { type: "string", opt: false, raw: false },
    },
    opt: false,
  };
  const source = {
    title: "Hello",
    body: "World",
    status: "draft",
    sections: [],
  };

  test("interleaves changes and chunks in schema order", () => {
    const titleNode = makeNode(sp('"home"."title"'), dummyChange);
    const statusNode = makeNode(sp('"home"."status"'), dummyChange);

    const unchanged: UnchangedSibling[] = [
      { key: "body", sourcePath: sp('"home"."body"') },
      { key: "sections", sourcePath: sp('"home"."sections"') },
    ];

    const items = buildOrderedItems(
      objectSchema,
      source,
      [titleNode, statusNode],
      unchanged,
    );

    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ kind: "change", node: titleNode });
    expect(items[1]).toEqual({
      kind: "chunk",
      siblings: [{ key: "body", sourcePath: sp('"home"."body"') }],
    });
    expect(items[2]).toEqual({ kind: "change", node: statusNode });
    expect(items[3]).toEqual({
      kind: "chunk",
      siblings: [{ key: "sections", sourcePath: sp('"home"."sections"') }],
    });
  });

  test("groups consecutive unchanged siblings into one chunk", () => {
    const titleNode = makeNode(sp('"home"."title"'), dummyChange);

    const unchanged: UnchangedSibling[] = [
      { key: "body", sourcePath: sp('"home"."body"') },
      { key: "status", sourcePath: sp('"home"."status"') },
      { key: "sections", sourcePath: sp('"home"."sections"') },
    ];

    const items = buildOrderedItems(
      objectSchema,
      source,
      [titleNode],
      unchanged,
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: "change", node: titleNode });
    expect(items[1]).toEqual({ kind: "chunk", siblings: unchanged });
  });

  test("array schema orders by index", () => {
    const arraySchema: SerializedSchema = {
      type: "array",
      item: { type: "string", opt: false, raw: false },
      opt: false,
    };
    const arrSource = ["a", "b", "c", "d", "e"];

    const node1 = makeNode(sp('"items".1'), dummyChange);
    const node3 = makeNode(sp('"items".3'), dummyChange);

    const unchanged: UnchangedSibling[] = [
      { key: "0", sourcePath: sp('"items".0') },
      { key: "2", sourcePath: sp('"items".2') },
      { key: "4", sourcePath: sp('"items".4') },
    ];

    const items = buildOrderedItems(
      arraySchema,
      arrSource,
      [node1, node3],
      unchanged,
    );

    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      kind: "chunk",
      siblings: [{ key: "0", sourcePath: sp('"items".0') }],
    });
    expect(items[1]).toEqual({ kind: "change", node: node1 });
    expect(items[2]).toEqual({
      kind: "chunk",
      siblings: [{ key: "2", sourcePath: sp('"items".2') }],
    });
    expect(items[3]).toEqual({ kind: "change", node: node3 });
    expect(items[4]).toEqual({
      kind: "chunk",
      siblings: [{ key: "4", sourcePath: sp('"items".4') }],
    });
  });

  test("returns changes when no unchanged siblings provided", () => {
    const titleNode = makeNode(sp('"home"."title"'), dummyChange);
    const items = buildOrderedItems(objectSchema, source, [titleNode], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ kind: "change", node: titleNode });
  });
});
