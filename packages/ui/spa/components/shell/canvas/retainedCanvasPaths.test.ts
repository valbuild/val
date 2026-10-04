import type { SourcePath } from "@valbuild/core";
import { mergeRetainedPaths } from "./retainedCanvasPaths";

const path = (name: string) => `/content/page.val.ts?p="${name}"` as SourcePath;
const TITLE = path("title");
const BODY = path("body");
const IMAGE = path("image");
const LINK = path("link");

const keepAll = () => true;
const keepNone = () => false;

describe("mergeRetainedPaths", () => {
  test("a kept path the page stopped reporting stays where it was", () => {
    expect(
      mergeRetainedPaths([TITLE, BODY, LINK], [TITLE, LINK], keepAll),
    ).toEqual([TITLE, BODY, LINK]);
  });

  test("a path that is not kept goes", () => {
    expect(
      mergeRetainedPaths([TITLE, BODY, LINK], [TITLE, LINK], keepNone),
    ).toEqual([TITLE, LINK]);
  });

  test("kept paths in a row keep their order", () => {
    expect(
      mergeRetainedPaths([TITLE, BODY, IMAGE, LINK], [TITLE, LINK], keepAll),
    ).toEqual([TITLE, BODY, IMAGE, LINK]);
  });

  test("a kept path at the top stays at the top", () => {
    expect(mergeRetainedPaths([TITLE, BODY], [BODY], keepAll)).toEqual([
      TITLE,
      BODY,
    ]);
  });

  test("the page's own order wins for what it reports", () => {
    // The page moved LINK above TITLE; BODY stays after TITLE, its anchor.
    expect(
      mergeRetainedPaths([TITLE, BODY, LINK], [LINK, TITLE], keepAll),
    ).toEqual([LINK, TITLE, BODY]);
  });

  test("nothing is invented: only paths that were listed are kept", () => {
    // `keep` says yes to everything, but IMAGE was never in the column.
    expect(mergeRetainedPaths([TITLE], [TITLE, LINK], keepAll)).toEqual([
      TITLE,
      LINK,
    ]);
  });

  test("a path the page reports again is listed once", () => {
    expect(mergeRetainedPaths([TITLE, BODY], [TITLE, BODY], keepAll)).toEqual([
      TITLE,
      BODY,
    ]);
  });

  test("an unchanged answer is the previous array, not a copy", () => {
    const previous = [TITLE, BODY, LINK];
    expect(mergeRetainedPaths(previous, [TITLE, LINK], keepAll)).toBe(previous);
    expect(mergeRetainedPaths(previous, [...previous], keepNone)).toBe(
      previous,
    );
  });
});
