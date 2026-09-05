import {
  resolvePath as resolveAtPath,
  define,
  getSourceAtPath,
  isValModule,
  splitModulePath,
  splitModuleFilePathAndModulePath,
  parentOfSourcePath,
  splitJoinedSourcePaths,
} from "./module";
import { SelectorOfSchema } from "./schema";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { settings } from "./schema/settings";
import { string, StringSchema } from "./schema/string";
import { union } from "./schema/union";
import { GetSource } from "./selector";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { ModulePath, SourcePath } from "./val";
import { literal } from "./schema/literal";
import { richtext } from "./schema/richtext";
import { route, RouteSchema } from "./schema/route";
import { image, ImageSchema } from "./schema/image";

// import { i18n as initI18nSchema } from "./schema/i18n";
// import { i18n as initI18nSource } from "./source/i18n";
// const i18n = initI18nSchema(["en_US", "nb_NO"] as const);
// const val = {
//   i18n: initI18nSource(["en_US", "nb_NO"] as const),
// };
describe("module", () => {
  test("parse path", () => {
    expect(splitModulePath('"foo"."bar".1."zoo"' as ModulePath)).toStrictEqual([
      "foo",
      "bar",
      "1",
      "zoo",
    ]);

    expect(
      splitModulePath('"foo"."bar".1."z\\"oo"' as ModulePath),
    ).toStrictEqual(["foo", "bar", "1", 'z"oo']);

    expect(
      splitModulePath('"foo"."b.ar".1."z\\"oo"' as ModulePath),
    ).toStrictEqual(["foo", "b.ar", "1", 'z"oo']);
  });

  test("split joined paths", () => {
    expect(
      splitJoinedSourcePaths(
        '/foo.val.ts?p="foo"."bar".1."zoo",/bar.val.ts?p="bar"."zo".1."do"' as ModulePath,
      ),
    ).toStrictEqual([
      '/foo.val.ts?p="foo"."bar".1."zoo"',
      '/bar.val.ts?p="bar"."zo".1."do"',
    ]);
  });

  test("getSourceAtPath: basic selector", () => {
    const [, modulePath] = splitModuleFilePathAndModulePath(
      '/app?p="foo"."bar".1."zoo"' as SourcePath,
    );
    expect(modulePath).toStrictEqual('"foo"."bar".1."zoo"');
    const resolvedModuleAtPath = getSourceAtPath(
      modulePath,
      newSelectorProxy({
        foo: {
          bar: [{ zoo: "zoo1" }, { zoo: "zoo2" }],
        },
      }),
    );
    expect(resolvedModuleAtPath[GetSource]).toStrictEqual("zoo2");
  });

  test("getSourceAtPath: basic source", () => {
    const resolvedModuleAtPath = getSourceAtPath(
      '"foo"."bar".1."zoo"' as ModulePath,
      {
        foo: {
          bar: [{ zoo: "zoo1" }, { zoo: "zoo2" }],
        },
      },
    );
    expect(resolvedModuleAtPath).toStrictEqual("zoo2");
  });

  test("getSourceAtPath: with dots and escaped quotes", () => {
    const resolvedModuleAtPath = getSourceAtPath(
      '"foo"."b.ar".1."z\\"oo"' as ModulePath,
      newSelectorProxy({
        foo: {
          "b.ar": [{ 'z"oo': "zoo1" }, { 'z"oo': "zoo2" }],
        },
      }),
    );
    expect(resolvedModuleAtPath[GetSource]).toStrictEqual("zoo2");
  });

  test("getSchemaAtPath: array & object", () => {
    const basicSchema = array(
      object({
        foo: array(object({ bar: string() })),
        zoo: number(),
      }),
    );
    const { schema, source } = resolveAtPath(
      '0."foo".0."bar"' as ModulePath,
      [
        {
          foo: [
            {
              bar: "bar1",
            },
          ],
          zoo: 1,
        },
      ] as SelectorOfSchema<typeof basicSchema>,
      basicSchema,
    );
    expect(schema).toBeInstanceOf(StringSchema);
    expect(source).toStrictEqual("bar1");
  });

  // test("getSchemaAtPath: i18n", () => {
  //   const basicSchema = array(
  //     object({
  //       foo: i18n(array(object({ bar: string() }))),
  //       zoo: number(),
  //     })
  //   );
  //   const res = resolveAtPath(
  //     '0."foo"."nb_NO".0."bar"' as ModulePath,
  //     [
  //       {
  //         foo: val.i18n({
  //           en_US: [
  //             {
  //               bar: "dive",
  //             },
  //           ],
  //           nb_NO: [
  //             {
  //               bar: "brun",
  //             },
  //           ],
  //         }),
  //         zoo: 1,
  //       },
  //     ] as SchemaTypeOf<typeof basicSchema>,
  //     basicSchema.serialize()
  //   );
  //   expect(res.schema).toStrictEqual(string().serialize());
  //   expect(res.source).toStrictEqual("brun");
  // });

  test("getSchemaAtPath: union", () => {
    const basicSchema = array(
      object({
        foo: union(
          "type",
          object({ type: literal("test1"), bar: object({ zoo: string() }) }),
          object({ type: literal("test2"), bar: object({ zoo: number() }) }),
        ),
      }),
    );
    const res = resolveAtPath(
      '0."foo"."bar"."zoo"' as ModulePath,
      [
        {
          foo: {
            type: "test2",
            bar: { zoo: 1 },
          },
        },
      ] as SelectorOfSchema<typeof basicSchema>,
      basicSchema["executeSerialize"](),
    );
    expect(res.schema).toStrictEqual(number()["executeSerialize"]());
    expect(res.source).toStrictEqual(1);
  });

  test("parentOfSourcePath", () => {
    const base = '/content/test?p="one".2."three"' as SourcePath;
    expect(parentOfSourcePath(base)).toStrictEqual('/content/test?p="one".2');
    expect(parentOfSourcePath(parentOfSourcePath(base))).toStrictEqual(
      '/content/test?p="one"',
    );
    expect(
      parentOfSourcePath(parentOfSourcePath(parentOfSourcePath(base))),
    ).toStrictEqual("/content/test");
    expect(
      parentOfSourcePath(
        parentOfSourcePath(parentOfSourcePath(parentOfSourcePath(base))),
      ),
    ).toStrictEqual("/content/test");
  });

  /**
   * Richtext content has no schema of its own per node, so resolving a path
   * INTO it walks out to the richtext field and reads the option that governs
   * that node: `a` for an anchor's href, `img` for an image's src. Both are
   * reached through `instanceof RichTextSchema`, which narrows the options to
   * `any` - so nothing here is checked by tsc, and a rename that misses one of
   * these branches silently hands back the richtext schema instead.
   */
  test("resolvePath: an anchor href resolves to the schema its `a` option carries", () => {
    const schema = object({
      body: richtext({ a: route() }),
    });
    const { schema: resolved } = resolveAtPath(
      '"body".0."children".0."href"' as ModulePath,
      {
        body: [
          {
            tag: "p",
            children: [{ tag: "a", href: "/blogs/one", children: ["One"] }],
          },
        ],
      } as SelectorOfSchema<typeof schema>,
      schema,
    );
    expect(resolved).toBeInstanceOf(RouteSchema);
  });

  test("resolvePath: an image src resolves to the schema its `img` option carries", () => {
    const schema = object({
      body: richtext({ img: image() }),
    });
    const { schema: resolved } = resolveAtPath(
      '"body".0."children".0."src"' as ModulePath,
      {
        body: [
          {
            tag: "p",
            children: [{ tag: "img", src: { path: "/public/val/one.png" } }],
          },
        ],
      } as SelectorOfSchema<typeof schema>,
      schema,
    );
    expect(resolved).toBeInstanceOf(ImageSchema);
  });

  test("resolvePath: into a settings section", () => {
    const schema = settings();
    const { schema: resolved, source } = resolveAtPath(
      '"ai"."tone"' as ModulePath,
      { ai: { tone: "Plain and direct." } },
      schema,
    );
    expect(resolved).toBeInstanceOf(StringSchema);
    expect(source).toBe("Plain and direct.");
  });

  test("resolvePath: an UNSET settings key resolves rather than throwing", () => {
    // The difference between settings and an object: an object refuses a path
    // whose key is missing, and every settings key is optional, so refusing
    // would make `{}` — the normal state of a fresh settings module —
    // unresolvable at every path inside it.
    const schema = settings();
    const { schema: resolved, source } = resolveAtPath(
      '"ai"."tone"' as ModulePath,
      {},
      schema,
    );
    expect(resolved).toBeInstanceOf(StringSchema);
    expect(source).toBe(undefined);
  });

  test("isValModule tells a module apart from what else a .val.ts might export", () => {
    const schema = object({ text: string() });
    expect(
      isValModule(define("/content/test.val.ts", schema, { text: "hi" })),
    ).toBe(true);
    // A bare schema is the mistake this is here to catch: `export default
    // s.image()` in a file named `*.val.ts`.
    expect(isValModule(schema)).toBe(false);
    expect(isValModule({ text: "hi" })).toBe(false);
    expect(isValModule(null)).toBe(false);
    expect(isValModule(undefined)).toBe(false);
    expect(isValModule("/content/test.val.ts")).toBe(false);
  });
});
