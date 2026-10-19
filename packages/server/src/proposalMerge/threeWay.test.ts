import { applyPatch, deepClone, JSONOps } from "@valbuild/core/patch";
import { result } from "@valbuild/core/fp";
import { diffOps, mergeValues, reshaped, setAt } from "./threeWay";

describe("mergeValues", () => {
  const base = { title: "Sale", subtitle: "Go", hero: "a.png" };

  test("changed on one side: that side's", () => {
    expect(mergeValues(base, base, { ...base, title: "Summer" })).toEqual({
      value: { ...base, title: "Summer" },
      conflicts: [],
    });
    expect(mergeValues(base, { ...base, title: "Spring" }, base).value).toEqual(
      { ...base, title: "Spring" },
    );
  });

  test("different keys on each side combine", () => {
    expect(
      mergeValues(
        base,
        { ...base, title: "Spring" },
        { ...base, hero: "b.png" },
      ),
    ).toEqual({
      value: { title: "Spring", subtitle: "Go", hero: "b.png" },
      conflicts: [],
    });
  });

  test("the same key: a conflict, holding the site's value", () => {
    expect(
      mergeValues(
        base,
        { ...base, title: "Spring" },
        { ...base, title: "Summer" },
      ),
    ).toEqual({
      value: { ...base, title: "Spring" },
      conflicts: [
        { path: ["title"], base: "Sale", site: "Spring", proposal: "Summer" },
      ],
    });
  });

  test("the same value on both sides is still a conflict", () => {
    expect(
      mergeValues(
        base,
        { ...base, title: "Summer" },
        { ...base, title: "Summer" },
      ).conflicts,
    ).toEqual([
      { path: ["title"], base: "Sale", site: "Summer", proposal: "Summer" },
    ]);
  });

  test("a key removed on one side and changed on the other", () => {
    const { subtitle: _removed, ...withoutSubtitle } = base;
    void _removed;
    expect(
      mergeValues(base, { ...base, subtitle: "New" }, withoutSubtitle)
        .conflicts,
    ).toEqual([
      { path: ["subtitle"], base: "Go", site: "New", proposal: undefined },
    ]);
  });

  test("a list neither side reshaped merges item by item", () => {
    const list = [{ t: "a" }, { t: "b" }, { t: "c" }];
    expect(
      mergeValues(
        list,
        [{ t: "A" }, { t: "b" }, { t: "c" }],
        [{ t: "a" }, { t: "b" }, { t: "C" }],
      ),
    ).toEqual({ value: [{ t: "A" }, { t: "b" }, { t: "C" }], conflicts: [] });
  });

  test("a list one side reshaped is one conflict, the whole list", () => {
    const list = [{ t: "a" }, { t: "b" }];
    const site = [{ t: "new" }, { t: "a" }, { t: "b" }];
    const proposal = [{ t: "a" }, { t: "B" }];
    expect(mergeValues(list, site, proposal).conflicts).toEqual([
      { path: [], base: list, site, proposal },
    ]);
  });
});

describe("reshaped", () => {
  test("an edit is not a reshape; a move, an add and a remove are", () => {
    const list = ["a", "b", "c"];
    expect(reshaped(list, ["a", "B", "c"])).toBe(false);
    expect(reshaped(list, ["c", "a", "b"])).toBe(true);
    expect(reshaped(list, ["a", "b", "c", "d"])).toBe(true);
    expect(reshaped(list, ["a", "c"])).toBe(true);
  });
});

describe("setAt", () => {
  test("sets, and removes with undefined, leaving the original", () => {
    const doc = { a: { b: 1, c: 2 } };
    expect(setAt(doc, ["a", "b"], 3)).toEqual({ a: { b: 3, c: 2 } });
    expect(setAt(doc, ["a", "c"], undefined)).toEqual({ a: { b: 1 } });
    expect(doc).toEqual({ a: { b: 1, c: 2 } });
  });
});

describe("diffOps", () => {
  test.each([
    [
      { a: 1, b: 2 },
      { a: 1, b: 3, c: 4 },
    ],
    [{ a: 1, b: 2 }, { a: 1 }],
    [{ l: [1, 2, 3] }, { l: [1, 5, 3] }],
    [{ l: [1, 2, 3] }, { l: [3, 1] }],
    [{ r: { x: { n: 1 } } }, { r: { y: { n: 2 } } }],
  ])("turns %j into %j", (from, to) => {
    const applied = applyPatch(
      deepClone(from),
      new JSONOps(),
      diffOps(from, to),
    );
    expect(result.isOk(applied) && applied.value).toEqual(to);
  });
});
