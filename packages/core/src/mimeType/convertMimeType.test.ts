import { mimeTypeMatchesAccept } from "./convertMimeType";

/**
 * The `accept` matcher, which used to be written out three times -- in
 * `ImageSchema`, `FileSchema` and the media branch of `RecordSchema`. The
 * copies had drifted: the record one special-cased `image/*` to compare against
 * `"image/"`, while the other two compared against `"image"` and so matched
 * anything merely starting with those letters.
 */
describe("mimeTypeMatchesAccept", () => {
  test("matches an exact type", () => {
    expect(mimeTypeMatchesAccept("image/png", "image/png")).toBe(true);
    expect(mimeTypeMatchesAccept("image/jpeg", "image/png")).toBe(false);
  });

  test("matches any of a comma-separated list, spaces and all", () => {
    expect(mimeTypeMatchesAccept("image/webp", "image/png, image/webp")).toBe(
      true,
    );
    expect(mimeTypeMatchesAccept("image/gif", "image/png, image/webp")).toBe(
      false,
    );
  });

  test("the catch-all accepts anything", () => {
    expect(mimeTypeMatchesAccept("application/pdf", "*/*")).toBe(true);
  });

  test("a type wildcard matches that type only", () => {
    expect(mimeTypeMatchesAccept("image/png", "image/*")).toBe(true);
    expect(mimeTypeMatchesAccept("application/pdf", "image/*")).toBe(false);
  });

  test("a type wildcard does not match a type that merely starts the same", () => {
    // The bug the record copy was written to dodge: dropping the slash as well
    // as the star makes "image/*" match "imagex/png".
    expect(mimeTypeMatchesAccept("imagex/png", "image/*")).toBe(false);
  });
});
