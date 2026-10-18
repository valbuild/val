import path from "path";
import { posixPath } from "./posixPath";

/*
 * Against Node itself: `posixPath` exists so the request handlers can run where
 * `path` does not, and it is only correct while it answers what `path.posix`
 * answers. The cases are the shapes module paths take, and the edges of each
 * algorithm.
 */

const SEGMENTS = [
  "",
  "/",
  ".",
  "..",
  "a",
  "/a",
  "a/",
  "/a/b",
  "a/b/",
  "/a/./b",
  "/a/../b",
  "a/../../b",
  "/../a",
  "//a//b//",
  "./a.val.json",
  "../x/y.val.json",
  "/app/blogs/[blog]/page.val.ts",
  "/content/authors.val.ts",
  "...",
  "a/..",
];

const ABSOLUTE = [
  "/",
  "/a",
  "/a/",
  "/a/b",
  "/a/b/c",
  "/a/bc",
  "/ab/c",
  "/a/./b/../c",
  "/content",
  "/content/authors",
  "/content/authors/jane.val.json",
  "/app/blogs/[blog]",
  "//a",
];

describe("posixPath matches path.posix", () => {
  test.each(SEGMENTS)("normalize(%j)", (p) => {
    expect(posixPath.normalize(p)).toBe(path.posix.normalize(p));
  });

  test.each(SEGMENTS)("dirname(%j)", (p) => {
    expect(posixPath.dirname(p)).toBe(path.posix.dirname(p));
  });

  test.each(SEGMENTS.flatMap((a) => SEGMENTS.map((b) => [a, b])))(
    "join(%j, %j)",
    (a, b) => {
      expect(posixPath.join(a, b)).toBe(path.posix.join(a, b));
    },
  );

  test.each(ABSOLUTE.flatMap((a) => ABSOLUTE.map((b) => [a, b])))(
    "relative(%j, %j)",
    (a, b) => {
      expect(posixPath.relative(a, b)).toBe(path.posix.relative(a, b));
    },
  );

  const RELATIVE = ["a", "a/b", "a/b/c", "b", "a/../c", "app/page.val.ts"];
  test.each(RELATIVE.flatMap((a) => RELATIVE.map((b) => [a, b])))(
    "relative(%j, %j), both relative",
    (a, b) => {
      expect(posixPath.relative(a, b)).toBe(path.posix.relative(a, b));
    },
  );

  test("relative refuses one relative and one absolute rather than guess a cwd", () => {
    expect(() => posixPath.relative("a", "/b")).toThrow(/two absolute/);
  });
});
