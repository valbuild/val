import path from "path";
import { isValModuleUri, pathToUri, toModuleFilePath, uriToPath } from "./uri";

describe("isValModuleUri", () => {
  test("matches Val module extensions only", () => {
    expect(isValModuleUri("file:///a/page.val.ts")).toBe(true);
    expect(isValModuleUri("file:///a/page.val.tsx")).toBe(true);
    expect(isValModuleUri("file:///a/page.val.js")).toBe(true);
    expect(isValModuleUri("file:///a/page.ts")).toBe(false);
    expect(isValModuleUri("file:///a/val.config.ts")).toBe(false);
  });
});

describe("uriToPath", () => {
  test("strips the scheme from a plain file URI", () => {
    expect(uriToPath("file:///work/my-site/page.val.ts")).toBe(
      "/work/my-site/page.val.ts",
    );
  });

  test("decodes percent escapes", () => {
    expect(uriToPath("file:///work/my%20site/a%2Bb.val.ts")).toBe(
      "/work/my site/a+b.val.ts",
    );
  });

  test("drops the leading slash of a Windows drive letter", () => {
    // This is the form VS Code sends on Windows.
    expect(uriToPath("file:///c%3A/work/my-site")).toBe("c:/work/my-site");
    expect(uriToPath("file:///C:/work")).toBe("C:/work");
    expect(uriToPath("file:///c%3A")).toBe("c:");
  });

  test("leaves a path that merely starts with a letter and colon alone", () => {
    // `/ca:/x` is not a drive letter, so the leading slash has to stay.
    expect(uriToPath("file:///ca:/x")).toBe("/ca:/x");
  });

  test("reads an authority as a UNC path", () => {
    expect(uriToPath("file://server/share/page.val.ts")).toBe(
      "//server/share/page.val.ts",
    );
  });

  test("ignores a query or fragment", () => {
    expect(uriToPath("file:///work/a.val.ts?v=2#L3")).toBe("/work/a.val.ts");
  });

  test("passes non-file URIs and plain paths through", () => {
    expect(uriToPath("/work/my-site")).toBe("/work/my-site");
    expect(uriToPath("untitled:Untitled-1")).toBe("untitled:Untitled-1");
  });

  test("falls back to the raw text on a malformed escape", () => {
    // A broken client must not take the server down.
    expect(uriToPath("file:///work/%zz")).toBe("/work/%zz");
  });
});

describe("pathToUri", () => {
  test("round-trips a POSIX path", () => {
    expect(pathToUri("/work/my site/a.val.ts")).toBe(
      "file:///work/my%20site/a.val.ts",
    );
    expect(uriToPath(pathToUri("/work/my site/a.val.ts"))).toBe(
      "/work/my site/a.val.ts",
    );
  });

  test("roots a path that has no leading slash", () => {
    // A Windows path (`c:/work`) has no leading slash, but the URI needs one.
    expect(pathToUri("c:/work/a.val.ts")).toBe("file:///c%3A/work/a.val.ts");
    expect(uriToPath(pathToUri("c:/work/a.val.ts"))).toBe("c:/work/a.val.ts");
  });
});

describe("toModuleFilePath", () => {
  const root = path.resolve("/work/my-site");

  test("returns the path relative to the Val root", () => {
    expect(
      toModuleFilePath(root, pathToUri(path.join(root, "content/page.val.ts"))),
    ).toBe("/content/page.val.ts");
  });

  test("returns undefined for a file outside the Val root", () => {
    expect(
      toModuleFilePath(root, pathToUri(path.resolve("/work/other/a.val.ts"))),
    ).toBeUndefined();
  });

  test("returns undefined for the root itself", () => {
    expect(toModuleFilePath(root, pathToUri(root))).toBeUndefined();
  });
});
