import { isOnStep, nearestAllowedNumber } from "./numberRules";

describe("isOnStep", () => {
  test("counts from the origin", () => {
    expect(isOnStep(5, 1, 2)).toBe(true);
    expect(isOnStep(4, 1, 2)).toBe(false);
  });
  test("tolerates floating point", () => {
    expect(isOnStep(0.3, 0, 0.1)).toBe(true);
  });
});

describe("nearestAllowedNumber", () => {
  test("clamps to the bounds", () => {
    expect(nearestAllowedNumber(150, { min: 0, max: 100 })).toBe(100);
    expect(nearestAllowedNumber(-5, { min: 0, max: 100 })).toBe(0);
  });
  test("rounds to the step, counted from min", () => {
    expect(nearestAllowedNumber(42, { min: 0, step: 5 })).toBe(40);
    expect(nearestAllowedNumber(43, { min: 0, step: 5 })).toBe(45);
    expect(nearestAllowedNumber(4, { min: 1, step: 2 })).toBe(5);
  });
  test("does not round past the max", () => {
    // 99 is nearer 100 than 90, but 100 is not on the grid from 0 in 30s,
    // and the nearest that is (90) is what stays in range.
    expect(nearestAllowedNumber(99, { min: 0, max: 100, step: 30 })).toBe(90);
  });
  test("rounds an int to a whole number", () => {
    expect(nearestAllowedNumber(3.6, { integer: true })).toBe(4);
  });
  test("gives clean decimals", () => {
    expect(nearestAllowedNumber(0.31, { step: 0.1 })).toBe(0.3);
  });
  test("returns null when nothing is allowed", () => {
    expect(nearestAllowedNumber(1, { min: 5, max: 1 })).toBe(null);
    expect(nearestAllowedNumber(1, { integer: true, min: 0.2, max: 0.8 })).toBe(
      null,
    );
  });
  test("leaves an allowed value alone", () => {
    expect(nearestAllowedNumber(40, { min: 0, max: 100, step: 5 })).toBe(40);
  });
});
