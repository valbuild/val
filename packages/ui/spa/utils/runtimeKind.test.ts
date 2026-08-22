import { runtimeKind } from "./runtimeKind";

describe("runtimeKind", () => {
  test("separates the three things typeof calls 'object'", () => {
    expect(runtimeKind({})).toBe("object");
    expect(runtimeKind([])).toBe("array");
    expect(runtimeKind(null)).toBe("null");
  });

  test("agrees with typeof everywhere else", () => {
    for (const value of ["s", 1, true, undefined, () => {}, Symbol("s")]) {
      expect(runtimeKind(value)).toBe(typeof value);
    }
  });
});
