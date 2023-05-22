import {
  getSchemaAtPath,
  getSourceAtPath,
  parsePath,
  splitModuleIdAndModulePath,
} from "./module";
import { array } from "./schema/array";
import { i18n as initI18n } from "./schema/i18n";
import { number } from "./schema/number";
import { object, ObjectSchema } from "./schema/object";
import { string, StringSchema } from "./schema/string";
import { union } from "./schema/union";
import { getSchema, SourceOrExpr } from "./selector";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { ModulePath, SourcePath } from "./val";

const i18n = initI18n(["en_US", "nb_NO"]);
describe("module", () => {
  test("parse path", () => {
    expect(parsePath('"foo"."bar".1."zoo"' as ModulePath)).toStrictEqual([
      "foo",
      "bar",
      "1",
      "zoo",
    ]);

    expect(parsePath('"foo"."bar".1."z\\"oo"' as ModulePath)).toStrictEqual([
      "foo",
      "bar",
      "1",
      'z"oo',
    ]);

    expect(parsePath('"foo"."b.ar".1."z\\"oo"' as ModulePath)).toStrictEqual([
      "foo",
      "b.ar",
      "1",
      'z"oo',
    ]);
  });

  test("getSourceAtPath: basic selector", () => {
    const [, modulePath] = splitModuleIdAndModulePath(
      '/app."foo"."bar".1."zoo"' as SourcePath
    );
    expect(modulePath).toStrictEqual('"foo"."bar".1."zoo"');
    const resolvedModuleAtPath = getSourceAtPath(
      modulePath,
      newSelectorProxy({
        foo: {
          bar: [{ zoo: "zoo1" }, { zoo: "zoo2" }],
        },
      })
    );
    expect(resolvedModuleAtPath[SourceOrExpr]).toStrictEqual("zoo2");
  });

  test("getSourceAtPath: basic source", () => {
    const resolvedModuleAtPath = getSourceAtPath(
      '"foo"."bar".1."zoo"' as ModulePath,
      {
        foo: {
          bar: [{ zoo: "zoo1" }, { zoo: "zoo2" }],
        },
      }
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
      })
    );
    expect(resolvedModuleAtPath[SourceOrExpr]).toStrictEqual("zoo2");
  });

  test("getSchemaAtPath: array & object", () => {
    const basicSchema = array(
      object({
        foo: array(object({ bar: string() })),
        zoo: number(),
      })
    );
    expect(
      getSchemaAtPath('1."foo".2."bar"' as ModulePath, basicSchema)
    ).toBeInstanceOf(StringSchema);
    expect(
      getSchemaAtPath('1."foo".2."bar"' as ModulePath, basicSchema.serialize())
    ).toStrictEqual(string().serialize());
  });

  test("getSchemaAtPath: i18n", () => {
    const basicSchema = array(
      object({
        foo: i18n(array(object({ bar: string() }))),
        zoo: number(),
      })
    );
    expect(
      getSchemaAtPath(
        '1."foo"."nb_NO".2."bar"' as ModulePath,
        basicSchema.serialize()
      )
    ).toStrictEqual(string().serialize());
  });

  test("getSchemaAtPath: union", () => {
    const basicSchema = array(
      object({
        foo: union(
          "type",
          object({ type: string<"test1">(), bar: object({ zoo: string() }) }),
          object({ type: string<"test2">(), bar: object({ zoo: number() }) })
        ),
      })
    );
    console.log(
      getSchemaAtPath(
        '1."foo"."bar"."zoo"' as ModulePath,
        basicSchema.serialize()
      )
    );
  });
});
