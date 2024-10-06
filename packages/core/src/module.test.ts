import {
  resolvePath as resolveAtPath,
  getSourceAtPath,
  splitModulePath,
  splitModuleFilePathAndModulePath,
  parentOfSourcePath,
} from "./module";
import { SelectorOfSchema } from "./schema";
import { array } from "./schema/array";
import { number } from "./schema/number";
import { object } from "./schema/object";
import { string, StringSchema } from "./schema/string";
import { union } from "./schema/union";
import { GetSource } from "./selector";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { ModulePath, SourcePath } from "./val";
import { literal } from "./schema/literal";

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
      basicSchema.serialize(),
    );
    expect(res.schema).toStrictEqual(number().serialize());
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
});
