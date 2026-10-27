import { parseRangeHeader } from "./httpRange";

describe("parseRangeHeader", () => {
  test("no header is the whole body", () => {
    expect(parseRangeHeader(undefined, 100)).toEqual({ kind: "none" });
    expect(parseRangeHeader("", 100)).toEqual({ kind: "none" });
  });

  test("bytes=a-b is inclusive at both ends", () => {
    expect(parseRangeHeader("bytes=0-9", 100)).toEqual({
      kind: "range",
      start: 0,
      end: 9,
    });
  });

  test("Safari's opening probe, bytes=0-1", () => {
    expect(parseRangeHeader("bytes=0-1", 100)).toEqual({
      kind: "range",
      start: 0,
      end: 1,
    });
  });

  test("bytes=a- runs to the end", () => {
    expect(parseRangeHeader("bytes=90-", 100)).toEqual({
      kind: "range",
      start: 90,
      end: 99,
    });
  });

  test("bytes=-n is the last n bytes, and all of them when n is larger", () => {
    expect(parseRangeHeader("bytes=-10", 100)).toEqual({
      kind: "range",
      start: 90,
      end: 99,
    });
    expect(parseRangeHeader("bytes=-1000", 100)).toEqual({
      kind: "range",
      start: 0,
      end: 99,
    });
  });

  test("an end past the file is clamped to the file", () => {
    expect(parseRangeHeader("bytes=50-1000", 100)).toEqual({
      kind: "range",
      start: 50,
      end: 99,
    });
  });

  test("a start past the end is unsatisfiable", () => {
    expect(parseRangeHeader("bytes=100-", 100)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseRangeHeader("bytes=200-300", 100)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseRangeHeader("bytes=-0", 100)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseRangeHeader("bytes=-5", 0)).toEqual({ kind: "unsatisfiable" });
  });

  test("what is malformed or multi-range is ignored, not refused", () => {
    expect(parseRangeHeader("bytes=9-0", 100)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=a-b", 100)).toEqual({ kind: "none" });
    expect(parseRangeHeader("items=0-9", 100)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=0-1,5-6", 100)).toEqual({ kind: "none" });
  });
});
