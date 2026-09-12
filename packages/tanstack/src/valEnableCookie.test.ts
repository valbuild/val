import { hasValEnableCookie } from "./valEnableCookie";

describe("hasValEnableCookie", () => {
  it("matches val_enable=true", () => {
    expect(hasValEnableCookie("val_enable=true")).toBe(true);
  });

  it("does not match val_enable=false (set on disable instead of deleting)", () => {
    expect(hasValEnableCookie("val_enable=false")).toBe(false);
  });

  it("does not substring-match other cookie names", () => {
    expect(hasValEnableCookie("xval_enable=true")).toBe(false);
    expect(hasValEnableCookie("val_enabled=true")).toBe(false);
  });

  it("matches among multiple cookies with leading spaces", () => {
    expect(hasValEnableCookie("foo=bar; val_enable=true; baz=qux")).toBe(true);
    expect(
      hasValEnableCookie("foo=bar; xval_enable=true; val_enable=false"),
    ).toBe(false);
  });

  it("returns false for an empty cookie string", () => {
    expect(hasValEnableCookie("")).toBe(false);
  });

  it("ignores cookie parts without a value", () => {
    expect(hasValEnableCookie("val_enable")).toBe(false);
  });
});
