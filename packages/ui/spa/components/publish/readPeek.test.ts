/**
 * The rule for turning a peek answer into something the summary prompt can
 * carry. Its own test because getting it wrong is silent: a dropped change
 * makes the model describe a publish it was never told about.
 */
const UNKNOWN = Symbol("unknown");

function readPeek(peek: { status: string; data?: unknown }): unknown {
  if (peek.status === "ready") {
    return (peek as { data: unknown }).data;
  }
  if (peek.status === "absent") {
    return undefined;
  }
  return UNKNOWN;
}

describe("readPeek", () => {
  test("a ready answer is its value", () => {
    expect(readPeek({ status: "ready", data: "Hello" })).toBe("Hello");
  });

  test("null is a value, not an absence", () => {
    expect(readPeek({ status: "ready", data: null })).toBeNull();
  });

  test("absent is a definite answer — an added field's before-value", () => {
    // The bug this pins: treating `absent` as unknown dropped every add-only
    // publish, so the summary was written from "No changes."
    expect(readPeek({ status: "absent" })).toBeUndefined();
  });

  test("a loading answer is unknown, not unchanged", () => {
    for (const status of [
      "module-loading",
      "entry-loading",
      "entry-missing",
      "entry-failed",
    ]) {
      expect(readPeek({ status })).toBe(UNKNOWN);
    }
  });

  test("undefined for absent is what describeValue renders as (not set)", () => {
    // Ties the two halves together: absent → undefined → "(not set)".
    const { describeValue } = jest.requireActual<
      typeof import("./changeDescription")
    >("./changeDescription");
    expect(describeValue(readPeek({ status: "absent" }))).toBe("(not set)");
  });
});
