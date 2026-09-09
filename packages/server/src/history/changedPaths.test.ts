import type { ModuleFilePath } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { changedPathsOf } from "./changedPaths";

const MODULE = "/content/authors.val.ts" as ModuleFilePath;

function patch(...ops: Patch): { patch: Patch } {
  return { patch: ops };
}

/**
 * `changedPaths` is what the history pane highlights and what a restore
 * navigates to, so each one has to be a SourcePath the rest of the Studio can
 * resolve: the module file path, `?p=`, then one JSON-quoted segment per patch
 * path segment, joined with `.` — `/content/x.val.ts?p="teddy"."name"`. That is
 * the shape `Internal.splitModulePath` parses and `peek` accepts.
 */
describe("changedPathsOf", () => {
  test("a nested op path becomes one quoted segment per level", () => {
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: ["teddy", "name"], value: "x" }),
    ]);
    expect(paths).toEqual([`${MODULE}?p="teddy"."name"`]);
  });

  test("a top-level op path is one segment", () => {
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: ["title"], value: "x" }),
    ]);
    expect(paths).toEqual([`${MODULE}?p="title"`]);
  });

  test("array indices are unquoted segments, as patchPathToModulePath writes them", () => {
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: ["items", "2", "label"], value: "x" }),
    ]);
    expect(paths).toEqual([`${MODULE}?p="items".2."label"`]);
  });

  test("a segment containing a dot is not split", () => {
    // Record keys are arbitrary strings. Joining segments with "." before
    // quoting would turn one key into two segments.
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: ["v1.2", "name"], value: "x" }),
    ]);
    expect(paths).toEqual([`${MODULE}?p="v1.2"."name"`]);
  });

  test("the same path touched twice is listed once, where it first changed", () => {
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: ["b"], value: 1 }),
      patch(
        { op: "replace", path: ["a"], value: 1 },
        { op: "replace", path: ["b"], value: 2 },
      ),
    ]);
    expect(paths).toEqual([`${MODULE}?p="b"`, `${MODULE}?p="a"`]);
  });

  test("file ops name a file, not a place in the source, and are skipped", () => {
    const paths = changedPathsOf(MODULE, [
      patch(
        { op: "replace", path: ["hero"], value: { path: "/public/val/a.png" } },
        {
          op: "file",
          path: ["hero"],
          filePath: "/public/val/a.png",
          value: "data:image/png;base64,AAAA",
          remote: false,
        },
      ),
    ]);
    expect(paths).toEqual([`${MODULE}?p="hero"`]);
  });

  test("an op at the module root names the module itself", () => {
    const paths = changedPathsOf(MODULE, [
      patch({ op: "replace", path: [], value: {} }),
    ]);
    expect(paths).toEqual([MODULE]);
  });
});
