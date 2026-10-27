import { getInitials } from "./getInitials";

describe("getInitials", () => {
  test.each([
    ["Fredrik Ekholdt", "FE"],
    ["Ada", "AD"],
    ["Ada Byron King Lovelace", "AL"],
    ["  spaced   out  ", "SO"],
    ["ada lovelace", "AL"],
  ])("%s -> %s", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });

  test("takes one glyph, not two, from a single CJK name part", () => {
    expect(getInitials("田中")).toBe("田");
  });

  test("takes the first glyph of each part of a CJK name", () => {
    expect(getInitials("田中 太郎")).toBe("田太");
  });

  test("says something rather than nothing for an empty name", () => {
    expect(getInitials("")).toBe("?");
    expect(getInitials("   ")).toBe("?");
  });
});
