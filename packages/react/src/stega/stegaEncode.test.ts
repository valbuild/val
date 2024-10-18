import { getModuleIds, stegaEncode } from "./stegaEncode";
import { RawString, Schema, SelectorSource, initVal } from "@valbuild/core";
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
        image: c.file("/public/test1.png", {
          sha256: "1231",
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
        text: [{ tag: "p", children: ["Test"] }],
        n: 1,
        b: true,
      },
      {
        image: c.file("/public/test2.png", {
          sha256: "1232",
          width: 100,
          height: 100,
          mimeType: "image/png",
        }),
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
      "/api/val/files/public/test1.png?sha256=1231",
    );
    expect(vercelStegaSplit(transformed[1].image.url).cleaned).toStrictEqual(
      "/api/val/files/public/test2.png?sha256=1232",
    );

    expect(transformed[0].text.valPath).toStrictEqual(
      '/test.val.ts?p=0."text"',
    );
    expect(transformed[1].text.valPath).toStrictEqual(
      '/test.val.ts?p=1."text"',
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

type SchemaOf<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
