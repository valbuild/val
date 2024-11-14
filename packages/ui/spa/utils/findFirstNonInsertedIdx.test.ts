import { findFirstNonInsertedIdx } from "./findFirstNonInsertedIdx";

describe("findFirstNonInsertedIdx", () => {
  test("should return 0 if there is no previous items", () => {
    const current = ["1", "2", "3"];
    const result = findFirstNonInsertedIdx(current);
    expect(result).toBe(0);
  });

  test("should return 0 if there is prev includes an item that no longer exists", () => {
    const current = ["1", "2", "3"];
    const prev = ["1", "x", "3"];
    const result = findFirstNonInsertedIdx(current, prev);
    expect(result).toBe(0);
  });

  test("should return 0 if the order has changed", () => {
    const current = ["1", "2", "3"];
    const prev = ["1", "x", "3"];
    const result = findFirstNonInsertedIdx(current, prev);
    expect(result).toBe(0);
  });

  test("should return the first non-existing", () => {
    const current = ["1", "2", "3"];
    const prev = ["1", "2"];
    const result = findFirstNonInsertedIdx(current, prev);
    expect(result).toBe(2);
  });

  test("should return last position if all elements match", () => {
    const current = ["1", "2", "3"];
    const prev = ["1", "2", "3"];
    const result = findFirstNonInsertedIdx(current, prev);
    expect(result).toBe(3);
  });

  test("should return 0 if current has fewer items than current", () => {
    const current = ["1", "2"];
    const prev = ["1", "2", "3"];
    const result = findFirstNonInsertedIdx(current, prev);
    expect(result).toBe(0);
  });
});
