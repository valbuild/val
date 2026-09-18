import {
  getModuleIds,
  stegaEncode,
  type JsonEntryContentOf,
  type ResolvedVal,
  type RouteValueOf,
  type StegaOfSource,
  type ValEncodedString,
} from "./stegaEncode";
import {
  Internal,
  RawString,
  Schema,
  SelectorSource,
  SourceObject,
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

  test("skip stegaEncode on enum", () => {
    const schema = s.enum("one", "two");
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, "one"),
      {},
    );
    expect(transformed).toStrictEqual("one");
  });

  test("skip stegaEncode on discriminated union of objects", () => {
    const schema = s.discriminatedUnion(
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

  // `""` is a legal `s.literal`, so it is a legal tag. The variant resolver
  // used to test the tag for truthiness, so this arm was never matched and its
  // strings came back unencoded — silently, since the value is unchanged.
  test("a discriminated union tagged with an empty string still encodes its arm", () => {
    const schema = s.discriminatedUnion(
      "type",
      s.object({ type: s.literal(""), str: s.string() }),
      s.object({ type: s.literal("named"), num: s.number() }),
    );
    const transformed = stegaEncode(
      c.define("/test1.val.ts", schema, { type: "", str: "one" }),
      {},
    );
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

  test("skip stegaEncode on colors inside a discriminated union", () => {
    const schema = s.discriminatedUnion(
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
  // an inline union. Recursion into a variant is a separate path from the
  // record/array one above, and the skip has to survive it too.
  test("skip stegaEncode on code inside a discriminated union", () => {
    const schema = s.discriminatedUnion(
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
      text: s.richtext({ img: true }),
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

  test("an image inside a discriminated union arm is resolved", () => {
    const schema = s.object({
      block: s.discriminatedUnion(
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
      s.imageset({ dir: "/public/img" }),
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
      s.imageset({ dir: "/public/img" }),
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

/**
 * Resolving a view.
 *
 * `useVal(page.header)` has to read the header module. The pointer stored in the
 * page is a path and nothing else, and the app has no way to turn a path back
 * into a module — `val.modules` holds lazy `import()` thunks and
 * `<ValModulesClient>` is optional — so the module travels with the handle,
 * attached here rather than written into source.
 */
describe("view handles", () => {
  const headerVal = c.define(
    "/header.val.ts",
    s.object({ title: s.string() }),
    { title: "Blank" },
  );
  const pageSchema = s.object({
    title: s.string(),
    header: s.view(headerVal),
  });
  const pageVal = c.define("/page.val.ts", pageSchema, {
    title: "Hello",
    header: { view: "/header.val.ts" },
  });

  test("the pointer survives encoding, stega-free", () => {
    const page = stegaEncode(pageVal, {});
    // Still `{ view: ... }` to anything that reads it as data: the module rides
    // on a symbol, which does not serialize.
    expect(JSON.parse(JSON.stringify(page.header))).toEqual({
      view: "/header.val.ts",
    });
    // And no edit tag woven into the path, which would corrupt it.
    expect(page.header.view).toBe("/header.val.ts");
  });

  test("resolving the handle reads the module it points at", () => {
    const page = stegaEncode(pageVal, {});
    const header = stegaEncode(page.header, {});
    expect(vercelStegaSplit(header.title).cleaned).toBe("Blank");
    // The edit tag is the HEADER's own path, not the page's.
    expect(vercelStegaDecode(header.title)).toStrictEqual({
      origin: "val.build",
      data: { valPath: '/header.val.ts?p="title"' },
    });
  });

  /**
   * The type half. A reader hands back `ValView<HeaderSrc>` for the field, and
   * resolving that gives the header's content — so `useVal(page.header)` is
   * typed as the header, not as a pointer. This does not compile if the arm in
   * `ResolvedVal` stops matching.
   */
  test("the resolved type is the target's content", () => {
    type Page = ResolvedVal<typeof pageVal>;
    type HeaderHandle = Page["header"];
    const resolved: ResolvedVal<HeaderHandle> = {
      title: "Blank" as ValEncodedString,
    };
    expect(resolved.title).toBe("Blank");
    // A view exposes nothing: reading a property off the handle is an error,
    // which is what stops it being mistaken for content.
    const handle: HeaderHandle = {} as HeaderHandle;
    expect(Object.keys(handle)).toEqual([]);
  });

  test("a handle names the module to subscribe to", () => {
    const page = stegaEncode(pageVal, {});
    // Not the page: reading a view subscribes to what it points at, or an edit
    // to the header would never reach the component that read it.
    expect(getModuleIds(page.header)).toEqual(["/header.val.ts"]);
  });

  /**
   * A handle passed from a server component to a client one arrives as plain
   * JSON: the symbol is gone, and with it the module. Resolving it would return
   * the pointer — an object that looks like content and holds none — so it says
   * what happened instead.
   */
  test("a handle that lost its module says so", () => {
    const page = stegaEncode(pageVal, {});
    const overTheWire = JSON.parse(JSON.stringify(page.header));
    expect(() => stegaEncode(overTheWire, {})).toThrow(
      /has been serialized, which drops the module it points at/,
    );
  });

  test("a resolved handle shows the target's draft, not its committed source", () => {
    const page = stegaEncode(pageVal, {});
    const header = stegaEncode(page.header, {
      getModule: (moduleId) =>
        moduleId === "/header.val.ts" ? { title: "DRAFT" } : undefined,
    });
    expect(vercelStegaSplit(header.title).cleaned).toBe("DRAFT");
  });

  /**
   * The source a view sits in can come from the overlay store as plain JSON —
   * that is what a pending edit to the PAGE looks like — and that JSON never
   * went near a module. The schema is the module's own either way, which is why
   * the handle is built from the schema rather than from the source.
   */
  test("the handle survives the page itself being a draft", () => {
    const page = stegaEncode(pageVal, {
      getModule: (moduleId) =>
        moduleId === "/page.val.ts"
          ? { title: "Edited", header: { view: "/header.val.ts" } }
          : undefined,
    });
    expect(vercelStegaSplit(page.title).cleaned).toBe("Edited");
    const header = stegaEncode(page.header, {});
    expect(vercelStegaSplit(header.title).cleaned).toBe("Blank");
  });
});

/**
 * Reading through a view with the readers that need a MODULE, not a value.
 *
 * `useValKey`, `useValRoute`, `useValRouteUrl` and the `fetch*` counterparts all
 * pull a path, a schema and a source off what they are handed. A view has none
 * of those, and each of those readers already uses `undefined` / `null` to mean
 * "no such entry" — so before `resolveViewedModule` a view argument was not an
 * error, it was a silently empty answer. Both halves are pinned here: the
 * runtime one it shares, and the types the four reader files share.
 */
describe("reading a route or an entry through a view", () => {
  const notesVal = c.define(
    "/app/notes/[note]/page.val.ts",
    s.record(s.object({ title: s.string() })),
    { "/notes/one": { title: "One" } },
  );
  const pageSchema = s.object({ title: s.string(), notes: s.view(notesVal) });
  const pageVal = c.define("/page.val.ts", pageSchema, {
    title: "Hello",
    notes: { view: "/app/notes/[note]/page.val.ts" },
  });

  test("the handle resolves to the module the readers need", () => {
    const page = stegaEncode(pageVal, {});
    const resolved = Internal.resolveViewedModule<SourceObject>(page.notes);
    // The same object `s.view()` was given — so `Internal.getValPath`,
    // `getSchema` and `getSource` all answer, which is the whole requirement.
    expect(resolved).toBe(notesVal);
    expect(Internal.getValPath(resolved)).toBe("/app/notes/[note]/page.val.ts");
  });

  test("a module passed to the same readers is untouched", () => {
    expect(Internal.resolveViewedModule(notesVal)).toBe(notesVal);
  });

  /**
   * Symbols do not serialize, so a handle passed from a server component to a
   * client one arrives as the bare pointer. Resolving it would hand back an
   * object that looks like content and holds none — the same rule, and the same
   * message, `stegaEncode` uses.
   */
  test("a pointer that lost its module says so", () => {
    const page = stegaEncode(pageVal, {});
    const overTheWire = JSON.parse(JSON.stringify(page.notes));
    expect(() => Internal.resolveViewedModule(overTheWire)).toThrow(
      /has been serialized, which drops the module it points at/,
    );
  });

  /**
   * The type half, and the one that would go wrong silently: these two are
   * computed from the reader's argument, so a view arm that stops matching does
   * not fail to compile — it resolves to `never`, and every call to a reader
   * starts erroring at the CALL SITE in someone's app instead.
   */
  test("the entry and route types read through the view", () => {
    type NotesHandle = ResolvedVal<typeof pageVal>["notes"];

    // What `useValRoute(page.notes, params)` gives back: the record's item,
    // the same as passing the module itself.
    const throughView: RouteValueOf<NotesHandle> = {
      title: "One" as ValEncodedString,
    };
    const throughModule: RouteValueOf<typeof notesVal> = throughView;
    expect(throughModule?.title).toBe("One");

    // `JsonEntryContentOf` is `never` unless the record's values are
    // `.jsonValues()` markers — the point here is only that the view arm
    // agrees with the module arm rather than diverging.
    const sameShape: JsonEntryContentOf<NotesHandle> =
      undefined as unknown as JsonEntryContentOf<typeof notesVal>;
    expect(sameShape).toBeUndefined();
  });
});

/**
 * Reading a page that CONTAINS a view must not read the module it points at.
 *
 * A view is on the page's screen, but its content is not on the page — so
 * resolving one has to cost nothing until someone asks for it. Three things
 * could break that, and each is pinned below: the encoder could walk into the
 * module the schema now holds, the subscription could name it, or a
 * `.jsonValues()` entry thunk could fire. The third is the one that would
 * actually hurt: those are dynamic `import()`s, so an eager walk would pull
 * every entry of every viewed record into the bundle's critical path.
 *
 * The module OBJECT is reachable either way — `s.view(x)` needs a static import
 * to get `x`'s path at all, exactly as `s.keyOf(x)` does, so the bytes are in
 * whatever bundle holds the page. What must stay lazy is READING it.
 */
describe("reading a view is lazy", () => {
  /** Entry thunks, so a read that should not happen is countable. */
  let loaded: string[] = [];
  const entriesVal = c.define(
    "/entries.val.ts",
    s.record(s.object({ title: s.string() })).jsonValues(),
    {
      "/a": c.json(() => {
        loaded.push("/a");
        return Promise.resolve({ default: { title: "A" } });
      }),
      "/b": c.json(() => {
        loaded.push("/b");
        return Promise.resolve({ default: { title: "B" } });
      }),
    },
  );
  /** A plain target too, so the claim is not only about json markers. */
  const sidebarVal = c.define("/sidebar.val.ts", s.object({ x: s.string() }), {
    x: "side",
  });
  const pageSchema = s.object({
    title: s.string(),
    entries: s.view(entriesVal),
    sidebar: s.view(sidebarVal),
  });
  const pageVal = c.define("/lazy-page.val.ts", pageSchema, {
    title: "Hello",
    entries: { view: "/entries.val.ts" },
    sidebar: { view: "/sidebar.val.ts" },
  });

  beforeEach(() => {
    loaded = [];
  });

  test("the encoder never asks the store for a module a view names", () => {
    const asked: string[] = [];
    stegaEncode(pageVal, {
      getModule: (moduleId) => {
        asked.push(moduleId);
        return undefined;
      },
    });
    // The page, and nothing else. Asking for a target here would make every
    // page with a view wait on a module it is not showing.
    expect(asked).toEqual(["/lazy-page.val.ts"]);
  });

  test("the subscription names the page, not what its views point at", () => {
    // What `useVal(pageVal)` subscribes to. A view target in here would make
    // every page with a view re-render on an edit to a module it does not show.
    expect(getModuleIds(pageVal)).toEqual(["/lazy-page.val.ts"]);
  });

  /**
   * The one that would actually hurt. A `.jsonValues()` entry is a dynamic
   * `import()`, so an encoder that walked into a viewed record would pull every
   * entry of it into the critical path of a page that shows none of them.
   */
  test("no entry of a viewed .jsonValues() module is loaded", () => {
    stegaEncode(pageVal, {});
    expect(loaded).toEqual([]);
  });

  /**
   * The other half, so the three above cannot be satisfied by a view that never
   * resolves at all: asking for it DOES read it — and still only its own module.
   */
  test("resolving the handle is what reads the target", () => {
    const page = stegaEncode(pageVal, {});
    const asked: string[] = [];
    stegaEncode(page.sidebar, {
      getModule: (moduleId) => {
        asked.push(moduleId);
        return undefined;
      },
    });
    expect(asked).toEqual(["/sidebar.val.ts"]);
    // And resolving THAT view still did not touch the other one.
    expect(loaded).toEqual([]);
  });

  /**
   * `viewModulesOf` walks the schema INSTANCE, which is the whole schema tree.
   * Memoised per instance, and `Internal.getSchema` returns the module's own
   * instance — so the walk is once per schema for the life of the process, not
   * once per render. Identity is what proves the memo is being hit.
   */
  test("the schema walk happens once per schema, not once per render", () => {
    const schema = Internal.getSchema(pageVal);
    expect(Internal.viewModulesOf(schema)).toBe(Internal.viewModulesOf(schema));
    // And it does not descend INTO the modules it finds: two entries, the two
    // targets, and nothing from inside them.
    expect([...Internal.viewModulesOf(schema).keys()].sort()).toEqual([
      "/entries.val.ts",
      "/sidebar.val.ts",
    ]);
  });

  /**
   * The wire form carries the path and not the module. Otherwise every schema
   * payload the Studio loads would grow by the whole content of every module
   * any view points at.
   */
  test("the serialized schema carries a path, not a module", () => {
    const serialized = (pageSchema as Schema<SelectorSource>)[
      "executeSerialize"
    ]();
    const entries =
      serialized.type === "object" ? serialized.items["entries"] : undefined;
    expect(entries).toMatchObject({
      type: "view",
      moduleFilePath: "/entries.val.ts",
    });
    // Nothing on it but the declared fields — no module, no source.
    expect(Object.keys(entries ?? {}).sort()).toEqual([
      "description",
      "hidden",
      "moduleFilePath",
      "opt",
      "readonly",
      "render",
      "type",
    ]);
  });
});
