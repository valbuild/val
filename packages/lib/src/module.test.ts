import { getSourceAtPath, parsePath } from "./module";
import { SourceOrExpr } from "./selector";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { SourcePath } from "./val";

describe("module", () => {
  test("parse path", () => {
    expect(parsePath('"foo"."bar".1."zoo"')).toStrictEqual([
      "foo",
      "bar",
      "1",
      "zoo",
    ]);

    expect(parsePath('"foo"."bar".1."z\\"oo"')).toStrictEqual([
      "foo",
      "bar",
      "1",
      'z"oo',
    ]);

    expect(parsePath('"foo"."b.ar".1."z\\"oo"')).toStrictEqual([
      "foo",
      "b.ar",
      "1",
      'z"oo',
    ]);
  });

  test("getSourceAtPath: basic selector", () => {
    const resolvedModuleAtPath = getSourceAtPath(
      '/app."foo"."bar".1."zoo"' as SourcePath,
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
      '/app."foo"."bar".1."zoo"' as SourcePath,
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
      '/app."foo"."b.ar".1."z\\"oo"' as SourcePath,
      newSelectorProxy({
        foo: {
          "b.ar": [{ 'z"oo': "zoo1" }, { 'z"oo': "zoo2" }],
        },
      })
    );
    expect(resolvedModuleAtPath[SourceOrExpr]).toStrictEqual("zoo2");
  });
});
