import { getModuleIds, stegaEncode } from "./stegaEncode";
import {
  ImageMetadata,
  RawString,
  Schema,
  SelectorSource,
  initVal,
  SVG_VAL_PATH,
} from "@valbuild/core";
import { vercelStegaDecode, vercelStegaSplit } from "@vercel/stega";

const { s, c } = initVal();

describe("stega transform", () => {
  test("basic", () => {
    const schema = s.array(
      s.object({
        image: s.image(),
        text: s.richtext({}),
        n: s.number(),
        b: s.boolean(),
      }),
    );

    const valModule = c.define("/test.val.ts", schema, [
      {
        image: c.image("/public/val/test1.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
        text: [{ tag: "p", children: ["Test"] }],
        n: 1,
        b: true,
      },
      {
        image: c.image("/public/val/test2.png", {
          width: 100,
          height: 100,
          mimeType: "image/png",
          patch_id: "123",
        } as ImageMetadata),
        text: [{ tag: "p", children: ["Test"] }],
        n: 2,
        b: false,
      },
    ]);
    const transformed = stegaEncode(valModule, {});

    expect(transformed).toHaveLength(2);

    expect(vercelStegaDecode(transformed[0].image.url)).toStrictEqual({
      data: {
        valPath: '/test.val.ts?p=0."image"',
      },
      origin: "val.build",
    });
    expect(vercelStegaDecode(transformed[1].image.url)).toStrictEqual({
      data: {
        valPath: '/test.val.ts?p=1."image"',
      },
      origin: "val.build",
    });
    //
    expect(vercelStegaSplit(transformed[0].image.url).cleaned).toStrictEqual(
      "/val/test1.png",
    );
    expect(vercelStegaSplit(transformed[1].image.url).cleaned).toStrictEqual(
      "/val/test2.png",
    );

    expect(vercelStegaDecode(transformed[0].text[0].children[0])).toStrictEqual(
      {
        data: {
          valPath: '/test.val.ts?p=0."text"',
        },
        origin: "val.build",
      },
    );

    expect(
      vercelStegaSplit(transformed[0].text[0].children[0]).cleaned,
    ).toStrictEqual("Test");

    expect(vercelStegaDecode(transformed[1].text[0].children[0])).toStrictEqual(
      {
        data: {
          valPath: '/test.val.ts?p=1."text"',
        },
        origin: "val.build",
      },
    );

    expect(
      vercelStegaSplit(transformed[1].text[0].children[0]).cleaned,
    ).toStrictEqual("Test");
  });

  test("basic with remote image", () => {
    const schema = s.array(s.image().remote());
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, [
        c.remote(
          "http://example.com/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/test.png",
          {
            width: 100,
            height: 100,
            mimeType: "image/png",
            hotspot: {
              x: 0.5,
              y: 0.5,
            },
          },
        ),
      ]),
      {},
    );
    expect(vercelStegaDecode(transformed[0].url)).toStrictEqual({
      data: {
        valPath: "/test1.val.ts?p=0",
      },
      origin: "val.build",
    });
    expect(vercelStegaSplit(transformed[0].url).cleaned).toStrictEqual(
      "http://example.com/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/test.png",
    );
  });

  test("get modules", () => {
    const schema = s.array(s.string());

    expect(
      getModuleIds({
        foo: [
          { test: c.define("/test1.val.ts", schema, ["one", "two"]) },
          { test: c.define("/test2.val.ts", schema, ["one", "two"]) },
        ],
        test: c.define("/test3.val.ts", schema, ["one", "two"]),
      }),
    ).toStrictEqual(["/test1.val.ts", "/test2.val.ts", "/test3.val.ts"]);
  });

  test("basic transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, ["one", "two"]),
      {
        getModule: (moduleId) => {
          if (moduleId === "/test1.val.ts") {
            return ["1", "2"];
          }
        },
      },
    );

    expect(vercelStegaSplit(transformed[0]).cleaned).toStrictEqual("1");
    expect(vercelStegaDecode(transformed[0])).toStrictEqual({
      data: {
        valPath: "/test1.val.ts?p=0",
      },
      origin: "val.build",
    });
  });

  test("skip stegaEncode on raw strings", () => {
    const schema = s.object({ str: s.string(), rawStr: s.string().raw() });
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, { str: "one", rawStr: "two" }),
      {},
    );
    //expect(transformed.str).toStrictEqual("one");
    expect(transformed.rawStr).toStrictEqual("two");
  });

  test("skip stegaEncode on union of strings", () => {
    const schema = s.union(s.literal("one"), s.literal("two"));
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, "one"),
      {},
    );
    expect(transformed).toStrictEqual("one");
  });

  test("skip stegaEncode on union of objects", () => {
    const schema = s.union(
      "type",
      s.object({ type: s.literal("type1"), str: s.string() }),
      s.object({ type: s.literal("type2"), num: s.number() }),
    );
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        type: "type1",
        str: "one",
      }),
      {},
    );
    expect(transformed.type).toStrictEqual("type1");
    expect(vercelStegaSplit(transformed.str).cleaned).toStrictEqual("one");
    expect(vercelStegaDecode(transformed.str)).toStrictEqual({
      data: {
        valPath: '/test1.val.ts?p="str"',
      },
      origin: "val.build",
    });
  });

  test("skip stegaEncode on dates", () => {
    const schema = s.date();
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, "2024-08-21"),
      {},
    );
    expect(transformed).toStrictEqual("2024-08-21");
  });

  test("skip stegaEncode when using keyOf", () => {
    const schema1 = c.define("/test1.val.ts", s.record(s.string()), {
      test: "one",
    });
    const schema2 = s.keyOf(schema1);
    const transformed = stegaEncode(
      c.define("/test2.val.ts", schema2, "test"),
      {},
    );
    expect(transformed).toStrictEqual("test");
  });

  test("schema of keyOf objects should be a union of specific strings (not a collapsed 'string')", () => {
    const schema1 = c.define("/test1.val.ts", s.object({ test: s.string() }), {
      test: "one",
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const schema2 = s.keyOf(schema1);
    const test: SchemaOf<typeof schema2> = "test";
    if (test === "test") {
      expect(true).toBeTruthy();
    } else {
      const _exhaustiveCheck: never = test;
      expect(_exhaustiveCheck).toBeFalsy();
    }
  });

  test("type of keyOf when using records should be RawString", () => {
    const schema1 = c.define("/test1.val.ts", s.record(s.string()), {
      test: "one",
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const schema2 = s.keyOf(schema1);
    const test: SchemaOf<typeof schema2> = "test" as RawString;
    const check: RawString = test; // if const test: SchemaOf<typeof schema2> is a string not a RawString, this line will fail on type check
    expect(check).toBeTruthy();
  });

  test("transform with get modules", () => {
    const schema = s.array(s.string());
    const transformed = stegaEncode(
      {
        foo: [
          { test: c.define("/test1.val.ts", schema, ["one", "two"]) },
          { test: c.define("/test2.val.ts", schema, ["one", "two"]) },
        ],
        test: c.define("/test3.val.ts", schema, ["one", "two"]),
      },
      {
        getModule: (moduleId) => {
          if (moduleId === "/test2.val.ts") {
            return ["1", "2"];
          }
        },
      },
    );

    expect(vercelStegaSplit(transformed.foo[0].test[0]).cleaned).toStrictEqual(
      "one",
    );
    expect(vercelStegaDecode(transformed.foo[0].test[0])).toStrictEqual({
      data: {
        valPath: "/test1.val.ts?p=0",
      },
      origin: "val.build",
    });

    //

    expect(vercelStegaSplit(transformed.foo[1].test[0]).cleaned).toStrictEqual(
      "1",
    );
    expect(vercelStegaDecode(transformed.foo[1].test[0])).toStrictEqual({
      data: {
        valPath: "/test2.val.ts?p=0",
      },
      origin: "val.build",
    });
  });
});

describe("stegaEncode root seed (jsonValues entries)", () => {
  // A `.jsonValues()` entry's content is plain JSON — it carries no selector
  // path/schema — so without a `root` seed stegaEncode cannot tag anything.
  const itemSchema = s.object({ title: s.string(), body: s.string() });
  const entryPath = '/app/support/[slug]/page.val.ts?p="/support/faq"';
  const content = { title: "FAQ", body: "Body" };

  test("without a root seed it is an identity transform (the bug)", () => {
    const res = stegaEncode(content, {});
    expect(res).toEqual(content);
    expect(vercelStegaDecode(res.title)).toBeUndefined();
  });

  test("with a root seed each string is tagged at the entry sub-path", () => {
    const res = stegaEncode(content, {
      root: {
        path: entryPath,
        schema: itemSchema["executeSerialize"](),
      },
    });
    expect(vercelStegaSplit(res.title).cleaned).toBe("FAQ");
    expect(vercelStegaDecode(res.title)).toEqual({
      origin: "val.build",
      data: { valPath: `${entryPath}."title"` },
    });
    expect(vercelStegaDecode(res.body)).toEqual({
      origin: "val.build",
      data: { valPath: `${entryPath}."body"` },
    });
  });

  test("disabled wins over the root seed", () => {
    const res = stegaEncode(content, {
      disabled: true,
      root: {
        path: entryPath,
        schema: itemSchema["executeSerialize"](),
      },
    });
    expect(res).toEqual(content);
  });
});

type SchemaOf<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;

describe("stega transform: svg", () => {
  const iconSchema = s.svg({
    variables: { brand: "#0055ff", line: "currentColor" },
  });
  const icon = {
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    children: [
      {
        tag: "path" as const,
        attrs: {
          d: "M12 2C8.7 2 6 4.7 6 8v5l-2 3h16l-2-3V8c0-3.3-2.7-6-6-6z",
          transform: "translate(1 1)",
          fill: { var: "brand" as const },
        },
        children: [],
      },
      {
        tag: "polyline" as const,
        attrs: { points: "1,2 3,4 5,6", stroke: { var: "line" as const } },
        children: [],
      },
    ],
  };

  test("leaves every string byte identical", () => {
    const valModule = c.define("/icon.val.ts", iconSchema, icon);
    const transformed = stegaEncode(valModule, {});

    // No invisible characters anywhere: an svg is machine parsed, so encoding
    // d / viewBox / points / transform would corrupt the icon.
    expect(transformed.viewBox).toBe(icon.viewBox);
    expect(transformed.children[0].attrs.d).toBe(icon.children[0].attrs.d);
    expect(transformed.children[0].attrs.transform).toBe(
      icon.children[0].attrs.transform,
    );
    expect(transformed.children[1].attrs.points).toBe(
      icon.children[1].attrs.points,
    );
    expect(vercelStegaDecode(transformed.children[0].attrs.d)).toBe(undefined);
    expect(vercelStegaDecode(transformed.viewBox)).toBe(undefined);
    expect(vercelStegaSplit(transformed.children[0].attrs.d).encoded).toBe("");
  });

  test("attaches the source path as a plain field, for ValSvg", () => {
    const valModule = c.define("/icon.val.ts", iconSchema, icon);
    const transformed = stegaEncode(valModule, {});
    expect(transformed[SVG_VAL_PATH]).toBe("/icon.val.ts");
  });

  test("carries the path of a nested svg", () => {
    const schema = s.record(iconSchema);
    const valModule = c.define("/icons.val.ts", schema, { bell: icon });
    const transformed = stegaEncode(valModule, {});
    expect(transformed.bell[SVG_VAL_PATH]).toBe('/icons.val.ts?p="bell"');
  });

  test("attaches nothing when stega is disabled", () => {
    const valModule = c.define("/icon.val.ts", iconSchema, icon);
    const transformed = stegaEncode(valModule, { disabled: true });
    expect(transformed[SVG_VAL_PATH]).toBe(undefined);
    expect(transformed.viewBox).toBe(icon.viewBox);
  });

  test("does not disturb stega encoding of sibling fields", () => {
    const schema = s.object({ title: s.string(), icon: iconSchema });
    const valModule = c.define("/page.val.ts", schema, {
      title: "Notifications",
      icon,
    });
    const transformed = stegaEncode(valModule, {});
    expect(vercelStegaDecode(transformed.title)).toStrictEqual({
      data: { valPath: '/page.val.ts?p="title"' },
      origin: "val.build",
    });
    expect(transformed.icon.children[0].attrs.d).toBe(icon.children[0].attrs.d);
  });
});
