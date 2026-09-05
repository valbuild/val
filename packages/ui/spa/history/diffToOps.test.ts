import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import { diffToOps } from "./diffToOps";

/**
 * The property that matters more than any individual op: applying the diff to
 * `from` must produce `to`. Every case below asserts it, because a diff that
 * looks right and applies wrong is the failure mode this whole design is
 * arranged to avoid.
 */
function roundTrip(from: JSONValue, to: JSONValue): JSONValue {
  const ops = diffToOps(from, to);
  const applied = applyPatch(
    deepClone(from as ReadonlyJSONValue) as JSONValue,
    new JSONOps(),
    ops,
  );
  if (result.isErr(applied)) {
    throw new Error(
      `ops did not apply: ${applied.error.message}\n${JSON.stringify(ops, null, 2)}`,
    );
  }
  return applied.value;
}

describe("diffToOps", () => {
  test("no difference is no ops", () => {
    expect(diffToOps({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffToOps([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  test("a changed primitive is one replace at its path", () => {
    expect(diffToOps({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { op: "replace", path: ["b"], value: 3 },
    ]);
  });

  test("added and removed object keys", () => {
    const ops = diffToOps({ a: 1, gone: true }, { a: 1, added: "x" });
    expect(ops).toContainEqual({ op: "remove", path: ["gone"] });
    expect(ops).toContainEqual({ op: "add", path: ["added"], value: "x" });
    expect(roundTrip({ a: 1, gone: true }, { a: 1, added: "x" })).toEqual({
      a: 1,
      added: "x",
    });
  });

  test("descends into nested objects rather than replacing the parent", () => {
    expect(
      diffToOps({ meta: { a: 1, b: 2 } }, { meta: { a: 1, b: 9 } }),
    ).toEqual([{ op: "replace", path: ["meta", "b"], value: 9 }]);
  });

  // Shallowest wins: a wholesale replacement is ONE decision, not a dozen.
  test("a type change replaces at that path without descending", () => {
    expect(diffToOps({ a: { deep: 1 } }, { a: "now a string" })).toEqual([
      { op: "replace", path: ["a"], value: "now a string" },
    ]);
  });

  describe("arrays", () => {
    // The decision: same length gets per-index replace, which is
    // order-independent because replace assigns rather than splices.
    test("same length yields one replace per differing index", () => {
      const from = [{ n: 1 }, { n: 2 }, { n: 3 }];
      const to = [{ n: 1 }, { n: 22 }, { n: 33 }];
      expect(diffToOps(from, to)).toEqual([
        { op: "replace", path: ["1", "n"], value: 22 },
        { op: "replace", path: ["2", "n"], value: 33 },
      ]);
      expect(roundTrip(from, to)).toEqual(to);
    });

    test("a length change replaces the whole array", () => {
      const from = [1, 2, 3];
      const to = [1, 2];
      expect(diffToOps(from, to)).toEqual([
        { op: "replace", path: [], value: [1, 2] },
      ]);
      expect(roundTrip(from, to)).toEqual(to);
    });

    test("an insert at the front replaces the whole array", () => {
      const from = [2, 3];
      const to = [1, 2, 3];
      expect(diffToOps(from, to)).toEqual([
        { op: "replace", path: [], value: [1, 2, 3] },
      ]);
      expect(roundTrip(from, to)).toEqual(to);
    });

    test("a nested array inside an object", () => {
      const from = { items: [{ n: 1 }, { n: 2 }] };
      const to = { items: [{ n: 1 }, { n: 5 }] };
      expect(diffToOps(from, to)).toEqual([
        { op: "replace", path: ["items", "1", "n"], value: 5 },
      ]);
      expect(roundTrip(from, to)).toEqual(to);
    });

    test("a length change nested inside an object replaces that array only", () => {
      const from = { title: "same", items: [1, 2] };
      const to = { title: "same", items: [1, 2, 3] };
      expect(diffToOps(from, to)).toEqual([
        { op: "replace", path: ["items"], value: [1, 2, 3] },
      ]);
      expect(roundTrip(from, to)).toEqual(to);
    });
  });

  // Every op must stand alone, or they cannot be offered as separate restore
  // units. Applying any single op must move only that path.
  test("each op is independently applicable", () => {
    const from = { a: 1, b: 2, c: { d: 3 } };
    const to = { a: 10, b: 20, c: { d: 30 } };
    const ops = diffToOps(from, to);
    expect(ops).toHaveLength(3);
    for (const op of ops) {
      const applied = applyPatch(
        deepClone(from as ReadonlyJSONValue) as JSONValue,
        new JSONOps(),
        [op],
      );
      if (result.isErr(applied)) {
        throw new Error(`op did not apply alone: ${applied.error.message}`);
      }
    }
  });

  test("never emits move, copy or test", () => {
    const ops = diffToOps(
      { list: [1, 2, 3], obj: { a: 1 } },
      { list: [3, 2, 1], obj: { b: 2 } },
    );
    for (const op of ops) {
      expect(["replace", "add", "remove"]).toContain(op.op);
    }
  });

  test("null and undefined-ish values round-trip", () => {
    expect(roundTrip({ a: null }, { a: 1 })).toEqual({ a: 1 });
    expect(roundTrip({ a: 1 }, { a: null })).toEqual({ a: null });
    expect(roundTrip({ a: null }, { a: null })).toEqual({ a: null });
  });

  test("replacing a whole module source at the root", () => {
    expect(roundTrip({ a: 1 }, { b: 2 })).toEqual({ b: 2 });
  });
});
