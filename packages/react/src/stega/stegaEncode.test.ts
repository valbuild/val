import { getModuleIds, stegaEncode, type StegaOfSource } from "./stegaEncode";
import {
  ImageMetadata,
  RawString,
  Schema,
  SelectorSource,
  initVal,
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

  // Colors end up in CSS (a style attribute, a custom property), where the
  // invisible characters stega appends would break the declaration. They must
  // therefore come out of stegaEncode byte-for-byte unchanged.
  test("skip stegaEncode on colors", () => {
    for (const [schema, color] of [
      [s.color(), "hsl(217.22 91.22% 59.8%)"],
      [s.color({ format: "hex" }), "#3b82f6"],
      [s.color({ format: "rgb" }), "rgb(59 130 246)"],
      [s.color({ format: "oklch" }), "oklch(0.6231 0.188 259.81)"],
      [
        s.color({ format: "hsl", alpha: true }),
        "hsl(217.22 91.22% 59.8% / 0.5)",
      ],
    ] as const) {
      const transformed = stegaEncode(
        c.define("/test1.val.ts", schema, color),
        {},
      );
      expect(transformed).toStrictEqual(color);
      expect(vercelStegaSplit(transformed).encoded).toStrictEqual("");
    }
  });

  test("skip stegaEncode on colors, but not on the strings next to them", () => {
    const schema = s.object({
      brand: s.color(),
      overlay: s.color({ format: "hsl", alpha: true }).nullable(),
      label: s.string(),
    });
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        brand: "hsl(217.22 91.22% 59.8%)",
        overlay: "hsl(217.22 91.22% 59.8% / 0.15)",
        label: "Brand",
      }),
      {},
    );
    expect(transformed.brand).toStrictEqual("hsl(217.22 91.22% 59.8%)");
    expect(transformed.overlay).toStrictEqual(
      "hsl(217.22 91.22% 59.8% / 0.15)",
    );
    // the sibling string is still encoded: the color is skipped because of its
    // schema, not because encoding is off for the whole module
    expect(vercelStegaSplit(transformed.label).cleaned).toStrictEqual("Brand");
    expect(vercelStegaDecode(transformed.label)).toStrictEqual({
      data: {
        valPath: '/test1.val.ts?p="label"',
      },
      origin: "val.build",
    });
  });

  test("skip stegaEncode on colors nested in records and arrays", () => {
    const schema = s.record(s.array(s.object({ fill: s.color() })));
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        theme: [{ fill: "hsl(0 100% 50%)" }, { fill: "hsl(120 100% 50%)" }],
      }),
      {},
    );
    expect(transformed.theme[0].fill).toStrictEqual("hsl(0 100% 50%)");
    expect(transformed.theme[1].fill).toStrictEqual("hsl(120 100% 50%)");
  });

  test("skip stegaEncode on colors inside a tagged union", () => {
    const schema = s.union(
      "type",
      s.object({ type: s.literal("solid"), fill: s.color() }),
      s.object({ type: s.literal("text"), body: s.string() }),
    );
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        type: "solid",
        fill: "hsl(0 100% 50%)",
      }),
      {},
    );
    expect(transformed.fill).toStrictEqual("hsl(0 100% 50%)");
  });

  test("stega type of a color is a plain string, not a ValEncodedString", () => {
    // An arbitrary string is assignable to the stega type of a color. It would
    // not be if the type claimed the value was encoded, since ValEncodedString
    // is branded - so this line pins the type to match the runtime skip above.
    const color: StegaOfSource<SchemaOf<ReturnType<typeof s.color>>> =
      "hsl(0 100% 50%)" as string;
    expect(color).toStrictEqual("hsl(0 100% 50%)");
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

type SchemaOf<T extends Schema<SelectorSource>> =
  T extends Schema<infer S> ? S : never;
