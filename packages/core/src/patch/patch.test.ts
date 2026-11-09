import { applyPatch } from "./patch";
import { JSONOps } from "./json";
import { JSONValue } from "./ops";
import { Operation } from "./operation";
import { deepClone } from "./util";
import * as result from "../fp/result";

/*
 * `applyPatch` with `test` ops: a test that does not hold fails the whole
 * patch (RFC 6902, 4.6), and the ops after it are not applied. It used to be
 * a no-op, because the Result `ops.test` returns was checked for truthiness.
 */
describe("applyPatch: test ops", () => {
  const document: JSONValue = {
    title: "Hello",
    count: 0,
    empty: "",
    nothing: null,
    tags: ["a", "b"],
    nested: { deep: { list: [1, { x: true }] } },
  };
  const replaceTitle: Operation = {
    op: "replace",
    path: ["title"],
    value: "after the test",
  };

  function apply(patch: Operation[]) {
    return applyPatch(deepClone(document), new JSONOps(), patch);
  }
  function errorOf(patch: Operation[]): string {
    const res = apply(patch);
    if (result.isOk(res)) {
      throw new Error("expected the patch to fail");
    }
    return res.error.message;
  }

  test.each<{ name: string; path: string[]; value: JSONValue }>([
    { name: "a string", path: ["title"], value: "Hello" },
    { name: "a falsy number", path: ["count"], value: 0 },
    { name: "an empty string", path: ["empty"], value: "" },
    { name: "null", path: ["nothing"], value: null },
    { name: "an array", path: ["tags"], value: ["a", "b"] },
    { name: "an array item", path: ["tags", "1"], value: "b" },
    {
      name: "nested objects and arrays, deeply",
      path: ["nested"],
      value: { deep: { list: [1, { x: true }] } },
    },
    { name: "the whole document", path: [], value: deepClone(document) },
  ])("a matching value passes: $name", ({ path, value }) => {
    expect(apply([{ op: "test", path, value }, replaceTitle])).toEqual(
      result.ok({ ...deepClone(document), title: "after the test" }),
    );
  });

  test.each<{ name: string; path: string[]; value: JSONValue }>([
    { name: "a different string", path: ["title"], value: "not the title" },
    { name: "0 is not false", path: ["count"], value: false },
    { name: '"" is not null', path: ["empty"], value: null },
    { name: "null is not {}", path: ["nothing"], value: {} },
    { name: "array order matters", path: ["tags"], value: ["b", "a"] },
    {
      name: "an array with an extra item",
      path: ["tags"],
      value: ["a", "b", "c"],
    },
    {
      name: "an array is not an object",
      path: ["tags"],
      value: { 0: "a", 1: "b" },
    },
    {
      name: "a difference deep inside",
      path: ["nested"],
      value: { deep: { list: [1, { x: false }] } },
    },
    {
      name: "an extra key deep inside",
      path: ["nested"],
      value: { deep: { list: [1, { x: true, y: 1 }] } },
    },
    {
      name: "a missing key deep inside",
      path: ["nested"],
      value: { deep: { list: [1, {}] } },
    },
  ])("a mismatched value fails the patch: $name", ({ path, value }) => {
    expect(errorOf([{ op: "test", path, value }, replaceTitle])).toBe(
      "Test failed",
    );
  });

  test.each<{ name: string; path: string[] }>([
    { name: "a missing key", path: ["missing"] },
    { name: "below a missing key", path: ["missing", "deeper"] },
    { name: "an index out of bounds", path: ["tags", "2"] },
    { name: "the end of an array", path: ["tags", "-"] },
    { name: "inside a string", path: ["title", "0"] },
  ])("a missing path fails the patch: $name", ({ path }) => {
    expect(
      result.isErr(apply([{ op: "test", path, value: null }, replaceTitle])),
    ).toBe(true);
  });

  test("a missing key fails even when testing for null", () => {
    expect(errorOf([{ op: "test", path: ["missing"], value: null }])).toBe(
      "Path refers to non-existing object/array",
    );
  });

  test("a failing test stops the patch: nothing after it is applied", () => {
    const doc = deepClone(document);
    const res = applyPatch(doc, new JSONOps(), [
      { op: "test", path: ["title"], value: "not the title" },
      replaceTitle,
    ]);
    expect(result.isErr(res)).toBe(true);
    expect(doc).toEqual(document);
  });

  test("a test sees the ops before it in the same patch", () => {
    expect(
      apply([
        replaceTitle,
        { op: "test", path: ["title"], value: "after the test" },
      ]),
    ).toEqual(result.ok({ ...deepClone(document), title: "after the test" }));
    expect(
      errorOf([replaceTitle, { op: "test", path: ["title"], value: "Hello" }]),
    ).toBe("Test failed");
  });
});
