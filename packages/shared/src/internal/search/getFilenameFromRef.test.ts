import { getFilenameFromRef, getRefParts } from "./getFilenameFromRef";

const REMOTE_REF =
  "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc123/f/def456/p/public/val/images/hero.webp";

describe("getFilenameFromRef", () => {
  test("extracts the basename of a local ref", () => {
    expect(getFilenameFromRef("/public/val/images/hero.webp")).toBe(
      "hero.webp",
    );
  });

  test("extracts the basename of a ref directly under /public", () => {
    expect(getFilenameFromRef("/public/hero.webp")).toBe("hero.webp");
  });

  test("extracts the basename of a remote ref", () => {
    expect(getFilenameFromRef(REMOTE_REF)).toBe("hero.webp");
  });
});

describe("getRefParts", () => {
  test("strips the /public prefix from the folder", () => {
    expect(getRefParts("/public/val/images/hero.webp")).toEqual({
      cleanPath: "/public/val/images/hero.webp",
      filename: "hero.webp",
      folder: "/val/images",
    });
  });

  test("returns / for a file directly under /public", () => {
    expect(getRefParts("/public/hero.webp")).toEqual({
      cleanPath: "/public/hero.webp",
      filename: "hero.webp",
      folder: "/",
    });
  });

  test("only strips /public as a whole path segment", () => {
    expect(getRefParts("/publicity/images/hero.webp")).toEqual({
      cleanPath: "/publicity/images/hero.webp",
      filename: "hero.webp",
      folder: "/publicity/images",
    });
  });

  test("resolves a remote ref to its local-style path", () => {
    expect(getRefParts(REMOTE_REF)).toEqual({
      cleanPath: "/public/val/images/hero.webp",
      filename: "hero.webp",
      folder: "/val/images",
    });
  });

  test("keeps a folder that itself contains /public", () => {
    expect(getRefParts("/public/val/public/hero.webp")).toEqual({
      cleanPath: "/public/val/public/hero.webp",
      filename: "hero.webp",
      folder: "/val/public",
    });
  });
});
