import type { ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { findEntryImportPath } from "./getJsonEntryAtCommit";

const MODULE = "/app/support/[slug]/page.val.ts" as ModuleFilePath;
// The same module as git sees it: this project lives under examples/next.
const MODULE_GIT_PATH = "examples/next/app/support/[slug]/page.val.ts";

/**
 * Taken from the example app, because the shape of the problem is only visible
 * in a real one: the key is a ROUTE and the file is whatever the author named
 * it. `/support/getting-started` -> `getting-started.val.json` looks derivable
 * and is not; nothing enforces any relationship at all, which is why this has
 * to read the `import()` literal rather than compute a filename.
 */
const SOURCE = `
import { s, c, nextAppRouter } from "../../../val.config";

export default c.define(
  "/app/support/[slug]/page.val.ts",
  s.router(nextAppRouter, s.object({ title: s.string() })).jsonValues(),
  {
    "/support/getting-started": c.json(
      () => import("./content/getting-started.val.json"),
    ),
    "/support/faq": c.json(() => import("./elsewhere/q-and-a.val.json")),
  },
);
`;

function pathFor(key: string) {
  return findEntryImportPath(MODULE, MODULE_GIT_PATH, SOURCE, key);
}

describe("finding a jsonValues entry's file at a commit", () => {
  test("resolves the import path relative to the module", () => {
    const res = pathFor("/support/getting-started");
    if (result.isErr(res)) throw new Error(JSON.stringify(res.error));
    expect(res.value).toBe(
      "/app/support/[slug]/content/getting-started.val.json",
    );
  });

  // The one that would pass under a "filename is the key" shortcut and must
  // not: this entry's file shares nothing with its key.
  test("does not assume the file is named after the key", () => {
    const res = pathFor("/support/faq");
    if (result.isErr(res)) throw new Error(JSON.stringify(res.error));
    expect(res.value).toBe("/app/support/[slug]/elsewhere/q-and-a.val.json");
  });

  /*
   * A key added after this commit. Reported rather than treated as empty: an
   * empty field is a claim that the author left it blank, and that would be a
   * lie about a commit that predates the entry.
   */
  test("reports a key that had no entry at this commit", () => {
    const res = pathFor("/support/added-later");
    if (!result.isErr(res)) throw new Error("expected an error");
    expect(res.error.kind).toBe("file-unavailable");
    expect("message" in res.error && res.error.message).toMatch(
      /had no entry at this commit/,
    );
  });

  test("reports a module it cannot read, rather than reporting it empty", () => {
    const res = findEntryImportPath(
      MODULE,
      MODULE_GIT_PATH,
      "this is not typescript {{{",
      "k",
    );
    if (!result.isErr(res)) throw new Error("expected an error");
    expect(res.error.kind).toBe("file-unavailable");
  });

  // A module with no jsonValues entries at all: every key is absent, and that
  // is the same answer as a key that was added later.
  test("reports a key in a module that has no entries", () => {
    const plain = `
      import { s, c } from "./val.config";
      export default c.define("/app/page.val.ts", s.string(), "hello");
    `;
    const res = findEntryImportPath(
      MODULE,
      MODULE_GIT_PATH,
      plain,
      "/support/faq",
    );
    if (!result.isErr(res)) throw new Error("expected an error");
    expect(res.error.kind).toBe("file-unavailable");
  });

  /*
   * A `gitPath` in a HistoryError is a REPOSITORY path - what every other
   * history helper reports, and what a reader can paste into `git show`.
   * Reporting the project-relative ModuleFilePath named a file that does not
   * exist at that path for any project not rooted at the repository root.
   */
  test("reports the repository path, not the project-relative one", () => {
    const res = pathFor("/support/added-later");
    if (!result.isErr(res)) throw new Error("expected an error");
    expect("gitPath" in res.error && res.error.gitPath).toBe(MODULE_GIT_PATH);
  });
});
