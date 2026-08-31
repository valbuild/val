import { getModuleIds, stegaEncode, type StegaOfSource } from "./stegaEncode";
import {
  Internal,
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
        image: {
          path: "/public/val/test1.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
        },
        text: [{ tag: "p", children: ["Test"] }],
        n: 1,
        b: true,
      },
      {
        image: {
          path: "/public/val/test2.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
        },
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
        {
          path: "http://example.com/file/p/project123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/test.png",
          width: 100,
          height: 100,
          mimeType: "image/png",
          hotspot: {
            x: 0.5,
            y: 0.5,
          },
        },
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

  // Code has the same problem as a color, and worse: the invisible characters
  // stega appends are a syntax error in most languages, and silent corruption
  // inside a string literal. Byte-for-byte unchanged is the whole reason
  // `s.code()` is a schema type rather than a layout on `s.string()`.
  test("skip stegaEncode on code", () => {
    for (const [schema, code] of [
      [s.code(), "no language, still untouched"],
      [s.code({ language: "typescript" }), "const a = 1;"],
      [s.code({ language: "json" }), '{ "a": 1 }'],
      [s.code({ language: "python" }), "def f():\n    return 1\n"],
    ] as const) {
      const transformed = stegaEncode(
        c.define("/test1.val.ts", schema, code),
        {},
      );
      expect(transformed).toStrictEqual(code);
      expect(vercelStegaSplit(transformed).encoded).toStrictEqual("");
    }
  });

  test("skip stegaEncode on code, but not on the strings next to it", () => {
    const schema = s.object({
      snippet: s.code({ language: "typescript" }),
      styles: s.code({ language: "css" }).nullable(),
      caption: s.string(),
    });
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        snippet: "const a = 1;",
        styles: ".a { color: red }",
        caption: "An example",
      }),
      {},
    );
    expect(transformed.snippet).toStrictEqual("const a = 1;");
    expect(transformed.styles).toStrictEqual(".a { color: red }");
    // the sibling string is still encoded: the code is skipped because of its
    // schema, not because encoding is off for the whole module
    expect(vercelStegaSplit(transformed.caption).cleaned).toStrictEqual(
      "An example",
    );
    expect(vercelStegaDecode(transformed.caption)).toStrictEqual({
      data: {
        valPath: '/test1.val.ts?p="caption"',
      },
      origin: "val.build",
    });
  });

  test("skip stegaEncode on code nested in records and arrays", () => {
    const schema = s.record(s.array(s.object({ body: s.code() })));
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        examples: [{ body: "const a = 1;" }, { body: "const b = 2;" }],
      }),
      {},
    );
    expect(transformed.examples[0].body).toStrictEqual("const a = 1;");
    expect(transformed.examples[1].body).toStrictEqual("const b = 2;");
  });

  // The page-builder shape the example app uses: a code block as one variant of
  // an inline union. Recursion into a union member is a separate path from the
  // record/array one above, and the skip has to survive it too.
  test("skip stegaEncode on code inside a tagged union", () => {
    const schema = s.union(
      "type",
      s.object({
        type: s.literal("code"),
        code: s.code({ language: "typescript" }),
      }),
      s.object({ type: s.literal("text"), body: s.string() }),
    );
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, {
        type: "code",
        code: 'console.log("hi");',
      }),
      {},
    );
    expect(transformed.code).toStrictEqual('console.log("hi");');
  });

  test("stega type of code is a plain string, not a ValEncodedString", () => {
    // An arbitrary string is assignable to the stega type of code. It would not
    // be if the type claimed the value was encoded, since ValEncodedString is
    // branded - so this line pins the type to match the runtime skip above.
    const code: StegaOfSource<SchemaOf<ReturnType<typeof s.code>>> =
      "const a = 1;" as string;
    expect(code).toStrictEqual("const a = 1;");
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

describe("media is resolved from the schema, not from the value", () => {
  test("an image still has a url when steganography is disabled", () => {
    // `disabled: !enabled` is the normal production path. Media used to be
    // recognised from a marker on the value, so it resolved regardless; now it
    // is recognised from the schema, and dropping the schema here would strip
    // the url from every image on every production page.
    const schema = s.object({ image: s.image() });
    const valModule = c.define("/disabled.val.ts", schema, {
      image: {
        path: "/public/val/logo.png",
        width: 8,
        height: 8,
        mimeType: "image/png",
      },
    });
    const res = stegaEncode(valModule, { disabled: true });
    expect(res.image.url).toBe("/val/logo.png");
    expect(vercelStegaDecode(res.image.url)).toBeUndefined();
  });

  test("an image whose bytes are not committed is served by the files API", () => {
    const schema = s.object({ image: s.image() });
    const valModule = c.define("/draft.val.ts", schema, {
      image: {
        path: "/public/val/logo.png",
        width: 8,
        height: 8,
        mimeType: "image/png",
        patch_id: "pt1",
      },
    });
    const res = stegaEncode(valModule, {});
    expect(vercelStegaSplit(res.image.url).cleaned).toBe(
      "/api/val/files/public/val/logo.png?patch_id=pt1",
    );
  });

  test("a richtext inline image has a url", () => {
    // The richtext walker hands the RICHTEXT schema down to every key, so `src`
    // would look like a plain object unless the inline image schema is passed
    // to it explicitly.
    const schema = s.object({
      text: s.richtext({ inline: { img: true } }),
    });
    const valModule = c.define("/richtext.val.ts", schema, {
      text: [
        {
          tag: "p",
          children: [
            {
              tag: "img",
              src: {
                path: "/public/val/inline.png",
                width: 8,
                height: 8,
                mimeType: "image/png",
              },
            },
          ],
        },
      ],
    });
    const res = stegaEncode(valModule, {});
    const img = res.text[0].children[0];
    expect(vercelStegaSplit(img.src.url).cleaned).toBe("/val/inline.png");
  });

  test("an image inside a tagged union arm is resolved", () => {
    const schema = s.object({
      block: s.union(
        "type",
        s.object({ type: s.literal("hero"), image: s.image() }),
        s.object({ type: s.literal("text"), body: s.string() }),
      ),
    });
    const valModule = c.define("/union.val.ts", schema, {
      block: {
        type: "hero",
        image: {
          path: "/public/val/hero.png",
          width: 8,
          height: 8,
          mimeType: "image/png",
        },
      },
    });
    const res = stegaEncode(valModule, {});
    expect(vercelStegaSplit(res.block.image.url).cleaned).toBe("/val/hero.png");
  });

  test("a gallery-backed image gets its dimensions and alt from the gallery", () => {
    const gallery = c.define(
      "/gallery.val.ts",
      s.images({ directory: "/public/img" }),
      {
        "/public/img/hero.png": {
          width: 8,
          height: 8,
          mimeType: "image/png",
          alt: "The gallery's alt",
        },
      },
    );
    const schema = s.object({ hero: s.image(gallery) });
    const valModule = c.define("/gallery-field.val.ts", schema, {
      hero: { path: "/public/img/hero.png" },
    });
    const res = stegaEncode(valModule, {
      getModule: (modulePath) =>
        modulePath === "/gallery.val.ts"
          ? Internal.getSource(gallery)
          : undefined,
    });
    expect(res.hero.width).toBe(8);
    expect(res.hero.mimeType).toBe("image/png");
    // Dropping this makes every gallery-backed image render with an empty alt.
    expect(res.hero.alt).toBe("The gallery's alt");
  });

  test("a per-image alt beats the gallery's", () => {
    const gallery = c.define(
      "/gallery2.val.ts",
      s.images({ directory: "/public/img" }),
      {
        "/public/img/hero.png": {
          width: 8,
          height: 8,
          mimeType: "image/png",
          alt: "The gallery's alt",
        },
      },
    );
    const schema = s.object({ hero: s.image(gallery) });
    const valModule = c.define("/gallery-field2.val.ts", schema, {
      hero: { path: "/public/img/hero.png", alt: "This one only" },
    });
    const res = stegaEncode(valModule, {
      getModule: (modulePath) =>
        modulePath === "/gallery2.val.ts"
          ? Internal.getSource(gallery)
          : undefined,
    });
    expect(res.hero.alt).toBe("This one only");
  });

  test("a plain object that happens to have a path is left alone", () => {
    const schema = s.object({
      link: s.object({ path: s.string(), title: s.string() }),
    });
    const valModule = c.define("/plain.val.ts", schema, {
      link: { path: "/public/val/not-an-image.png", title: "A link" },
    });
    const res = stegaEncode(valModule, {});
    expect("url" in res.link).toBe(false);
    expect(vercelStegaSplit(res.link.path).cleaned).toBe(
      "/public/val/not-an-image.png",
    );
  });
});
