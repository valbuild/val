import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import { SelectorSource } from "@valbuild/core";
import { traverseSchemaSource, flattenRichText } from "./traverseSchemaSource";

const { s, c } = initVal();

describe("traverseSchemaSource", () => {
  describe("primitives", () => {
    test("string", () => {
      const module = c.define("/test.val.ts", s.object({ value: s.string() }), {
        value: "hello world",
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="value"', value: "hello world" },
      ]);
    });

    test("number", () => {
      const module = c.define("/test.val.ts", s.object({ value: s.number() }), {
        value: 42,
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([{ path: '/test.val.ts?p="value"', value: 42 }]);
    });

    test("boolean", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({ value: s.boolean() }),
        { value: true },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="value"', value: true },
      ]);
    });
  });

  describe("richtext", () => {
    test("flattens richtext content", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({ content: s.richtext() }),
        {
          content: [
            {
              tag: "p",
              children: [
                "Hello ",
                {
                  tag: "span",
                  styles: ["bold"],
                  children: ["world"],
                },
              ],
            },
          ],
        },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath }> = [];
      traverseSchemaSource(source, schema, path, ({ path }) => {
        visited.push({ path });
      });
      expect(visited).toEqual([{ path: '/test.val.ts?p="content"' }]);
    });
  });

  describe("file and image", () => {
    test("file extracts _ref", () => {
      const module = c.define("/test.val.ts", s.object({ file: s.file() }), {
        file: c.file("/public/val/test.pdf"),
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; source: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, source });
      });
      expect(visited.length).toBe(1);
      expect(visited[0].path).toBe('/test.val.ts?p="file"');
      expect(visited[0].source).toHaveProperty("_ref");
    });

    test("image extracts _ref", () => {
      const module = c.define("/test.val.ts", s.object({ image: s.image() }), {
        image: c.image("/public/val/test.jpg"),
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; source: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, source });
      });
      expect(visited.length).toBe(1);
      expect(visited[0].path).toBe('/test.val.ts?p="image"');
      expect(visited[0].source).toHaveProperty("_ref");
    });
  });

  describe("object", () => {
    test("nested object", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({
          level1: s.object({
            level2: s.string(),
          }),
        }),
        {
          level1: {
            level2: "nested value",
          },
        },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        {
          path: '/test.val.ts?p="level1"."level2"',
          value: "nested value",
        },
      ]);
    });
  });

  describe("record", () => {
    test("record with items", () => {
      const module = c.define(
        "/test.val.ts",
        s.record(s.object({ name: s.string() })),
        {
          item1: { name: "Item 1" },
          item2: { name: "Item 2" },
        },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="item1"."name"', value: "Item 1" },
        { path: '/test.val.ts?p="item2"."name"', value: "Item 2" },
      ]);
    });
  });

  describe("array", () => {
    test("array of strings", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({ items: s.array(s.string()) }),
        { items: ["foo", "bar", "baz"] },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="items".0', value: "foo" },
        { path: '/test.val.ts?p="items".1', value: "bar" },
        { path: '/test.val.ts?p="items".2', value: "baz" },
      ]);
    });
  });

  describe("union", () => {
    test("tagged union (discriminated)", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({
          item: s.union(
            "type",
            s.object({ type: s.literal("text"), content: s.string() }),
            s.object({ type: s.literal("link"), href: s.string() }),
          ),
        }),
        { item: { type: "text", content: "Hello" } },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="item"."type"', value: "text" },
        { path: '/test.val.ts?p="item"."content"', value: "Hello" },
      ]);
    });

    test("literal union (string values)", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({
          value: s.union(s.literal("foo"), s.literal("bar")),
        }),
        { value: "foo" },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="value"', value: "foo" },
      ]);
    });
  });

  describe("other types", () => {
    test("date", () => {
      const module = c.define("/test.val.ts", s.object({ date: s.date() }), {
        date: "2021-01-01",
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="date"', value: "2021-01-01" },
      ]);
    });

    test("keyOf", () => {
      const recordMod = c.define(
        "/records.val.ts",
        s.record(s.object({ name: s.string() })),
        { key1: { name: "Name 1" } },
      );
      const module = c.define(
        "/test.val.ts",
        s.object({ key: s.keyOf(recordMod) }),
        { key: "key1" },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="key"', value: "key1" },
      ]);
    });

    test("literal", () => {
      const module = c.define(
        "/test.val.ts",
        s.object({ value: s.literal("fixed") }),
        { value: "fixed" },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="value"', value: "fixed" },
      ]);
    });

    test("route", () => {
      const module = c.define("/test.val.ts", s.object({ route: s.route() }), {
        route: "/home",
      });
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; value: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, value: source });
      });
      expect(visited).toEqual([
        { path: '/test.val.ts?p="route"', value: "/home" },
      ]);
    });
  });

  describe("complex nested schemas", () => {
    test("object → array → union → object → record → richtext", () => {
      const recordMod = c.define(
        "/records.val.ts",
        s.record(s.object({ title: s.string() })),
        { rec1: { title: "Record 1" } },
      );
      const module = c.define(
        "/test.val.ts",
        s.object({
          container: s.object({
            items: s.array(
              s.union(
                "type",
                s.object({
                  type: s.literal("content"),
                  richtext: s.richtext(),
                }),
                s.object({
                  type: s.literal("record"),
                  record: s.keyOf(recordMod),
                }),
              ),
            ),
          }),
        }),
        {
          container: {
            items: [
              {
                type: "content",
                richtext: [
                  {
                    tag: "p",
                    children: ["Hello world"],
                  },
                ],
              },
              {
                type: "record",
                record: "rec1",
              },
            ],
          },
        },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath }> = [];
      traverseSchemaSource(source, schema, path, ({ path }) => {
        visited.push({ path });
      });
      // Should visit richtext and keyOf
      expect(visited.length).toBeGreaterThan(0);
      expect(visited.some((v) => v.path.includes("richtext"))).toBe(true);
      expect(visited.some((v) => v.path.includes("record"))).toBe(true);
    });

    test("record → array → union → object with file/image fields", () => {
      const module = c.define(
        "/test.val.ts",
        s.record(
          s.object({
            media: s.array(
              s.union(
                "type",
                s.object({
                  type: s.literal("image"),
                  image: s.image(),
                }),
                s.object({
                  type: s.literal("file"),
                  file: s.file(),
                }),
              ),
            ),
          }),
        ),
        {
          item1: {
            media: [
              { type: "image", image: c.image("/public/val/test.jpg") },
              { type: "file", file: c.file("/public/val/test.pdf") },
            ],
          },
        },
      );
      const { schema, source, path } = getTestData(module);
      const visited: Array<{ path: SourcePath; source: Json }> = [];
      traverseSchemaSource(source, schema, path, ({ source, path }) => {
        visited.push({ path, source });
      });
      // Should visit both image and file
      const imageVisits = visited.filter((v) => v.path.includes("image"));
      const fileVisits = visited.filter((v) => v.path.includes("file"));
      expect(imageVisits.length).toBe(1);
      expect(fileVisits.length).toBe(1);
      expect(imageVisits[0].source).toHaveProperty("_ref");
      expect(fileVisits[0].source).toHaveProperty("_ref");
    });
  });
});

describe("flattenRichText", () => {
  test("flattens richtext to plain text", () => {
    const richtext = [
      {
        tag: "p",
        children: [
          "Hello ",
          {
            tag: "span",
            styles: ["bold"],
            children: ["world"],
          },
        ],
      },
    ];
    const result = flattenRichText(richtext);
    expect(result).toBe("Hello world");
  });

  test("handles nested richtext", () => {
    const richtext = [
      {
        tag: "div",
        children: [
          {
            tag: "p",
            children: ["First paragraph"],
          },
          {
            tag: "p",
            children: ["Second paragraph"],
          },
        ],
      },
    ];
    const result = flattenRichText(richtext);
    expect(result).toBe("First paragraphSecond paragraph");
  });
});

function getTestData(valModule: ValModule<SelectorSource>) {
  const moduleFilePath = Internal.getValPath(
    valModule,
  ) as unknown as ModuleFilePath;
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) {
    throw new Error("Schema not found");
  }
  const source = Internal.getSource(valModule);
  const path = (moduleFilePath + "?p=") as SourcePath;
  return { schema, source, path };
}
