import { SourcePath } from "@valbuild/core";
import {
  ErrorsMap,
  errorsForModuleFilePath,
  errorsForSitemapEntry,
  indexNavErrors,
} from "./navErrors";
import { NavItemErrors } from "./types";

/**
 * The scan this index replaces, kept here as the oracle.
 *
 * The index is a performance change, so the thing worth testing is that it
 * answers IDENTICALLY - not that it happens to work on one example.
 */
function scanSitemapEntry(
  errorsMap: ErrorsMap,
  sourcePath: SourcePath,
): NavItemErrors | undefined {
  let ownCount = 0;
  let firstMessage: string | undefined;
  const exactPrefix = `${sourcePath}.`;
  for (const keyString in errorsMap) {
    const key = keyString as SourcePath;
    if (key !== sourcePath && !keyString.startsWith(exactPrefix)) continue;
    const list = errorsMap[key];
    if (!list || list.length === 0) continue;
    ownCount += list.length;
    if (!firstMessage) firstMessage = list[0]?.message;
  }
  return ownCount > 0 ? { ownCount, firstMessage } : undefined;
}

function scanModuleFilePath(
  errorsMap: ErrorsMap,
  fullPath: string,
): NavItemErrors | undefined {
  let ownCount = 0;
  let firstMessage: string | undefined;
  for (const keyString in errorsMap) {
    if (!keyString.startsWith(fullPath)) continue;
    const next = keyString.charAt(fullPath.length);
    if (next !== "" && next !== "?") continue;
    const list = errorsMap[keyString as SourcePath];
    if (!list || list.length === 0) continue;
    ownCount += list.length;
    if (!firstMessage) firstMessage = list[0]?.message;
  }
  return ownCount > 0 ? { ownCount, firstMessage } : undefined;
}

const BLOG = '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"' as SourcePath;
const OTHER_BLOG =
  '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-2"' as SourcePath;

const errorsMap: ErrorsMap = {
  // Directly on the entry.
  [BLOG]: [{ message: "entry is wrong" }],
  // Deeper inside the same entry - belongs to the same row.
  [`${BLOG}."title"` as SourcePath]: [
    { message: "title too short" },
    { message: "title is rude" },
  ],
  // A sibling entry, which must not leak into the first.
  [OTHER_BLOG]: [{ message: "other entry" }],
  // A different module entirely.
  ['/content/authors.val.ts?p="/a"."name"' as SourcePath]: [
    { message: "name missing" },
  ],
  // An empty list must count for nothing.
  ['/content/empty.val.ts?p="/x"' as SourcePath]: [],
};

describe("indexNavErrors", () => {
  const index = indexNavErrors(errorsMap);

  test("matches the per-node scan for sitemap entries", () => {
    for (const sourcePath of [BLOG, OTHER_BLOG]) {
      expect(errorsForSitemapEntry(index, sourcePath)).toStrictEqual(
        scanSitemapEntry(errorsMap, sourcePath),
      );
    }
  });

  test("matches the per-node scan for explorer files", () => {
    for (const fullPath of [
      "/content/authors.val.ts",
      "/app/blogs/[blog]/page.val.ts",
      "/content/empty.val.ts",
    ]) {
      expect(errorsForModuleFilePath(index, fullPath)).toStrictEqual(
        scanModuleFilePath(errorsMap, fullPath),
      );
    }
  });

  test("an entry's own and nested errors are summed onto its row", () => {
    expect(errorsForSitemapEntry(index, BLOG)).toStrictEqual({
      ownCount: 3,
      firstMessage: "entry is wrong",
    });
  });

  test("a sibling entry does not leak in", () => {
    expect(errorsForSitemapEntry(index, OTHER_BLOG)?.ownCount).toBe(1);
  });

  test("a path with nothing wrong is undefined, not a zero", () => {
    expect(
      errorsForSitemapEntry(index, '/app/x/page.val.ts?p="/x"' as SourcePath),
    ).toBeUndefined();
    expect(
      errorsForModuleFilePath(index, "/content/nope.val.ts"),
    ).toBeUndefined();
  });
});
