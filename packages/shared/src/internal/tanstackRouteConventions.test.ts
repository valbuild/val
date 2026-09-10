import { ModuleFilePath } from "@valbuild/core";
import {
  getPageRouterSourceFolder,
  getTanStackRouterSourceFolder,
  isTanStackRoutesFolder,
} from "./getNextAppRouterSourceFolder";
import {
  getPageRouterSitemapTree,
  getPatternFromModuleFilePath,
} from "./getSitemapTree";
import { parseRoutePattern } from "./parseRoutePattern";

describe("getTanStackRouterSourceFolder", () => {
  test.each<[string, string | null]>([
    ["/src/routes/index.val.ts", "/src/routes"],
    ["/routes/index.val.ts", "/routes"],
    ["/app/page.val.ts", null],
    ["/content/authors.val.ts", null],
    // A module literally called `routes.val.ts` is not a route folder.
    ["/routes.val.ts", null],
  ])("%s -> %p", (moduleFilePath, expected) => {
    expect(
      getTanStackRouterSourceFolder(moduleFilePath as ModuleFilePath),
    ).toBe(expected);
  });
});

describe("getPageRouterSourceFolder", () => {
  test("answers for either convention", () => {
    expect(
      getPageRouterSourceFolder("/app/page.val.ts" as ModuleFilePath),
    ).toBe("/app");
    expect(
      getPageRouterSourceFolder("/src/app/page.val.ts" as ModuleFilePath),
    ).toBe("/src/app");
    expect(
      getPageRouterSourceFolder("/src/routes/index.val.ts" as ModuleFilePath),
    ).toBe("/src/routes");
  });
});

describe("getPatternFromModuleFilePath for tanstack routes", () => {
  test.each<[string, string, string]>([
    ["/src/routes/index.val.ts", "/src/routes", ""],
    ["/src/routes/about.val.ts", "/src/routes", "/about"],
    ["/src/routes/posts.$postId.val.ts", "/src/routes", "/posts/[postId]"],
    ["/src/routes/posts/$postId.val.ts", "/src/routes", "/posts/[postId]"],
    ["/routes/files.$.val.ts", "/routes", "/files/[..._splat]"],
    ["/src/routes/(marketing)/about.val.ts", "/src/routes", "/about"],
    ["/src/routes/_layout.dashboard.val.ts", "/src/routes", "/dashboard"],
  ])("%s -> %s", (moduleFilePath, srcFolder, expected) => {
    expect(getPatternFromModuleFilePath(moduleFilePath, srcFolder)).toBe(
      expected,
    );
  });

  test("the pattern parses into the same vocabulary the Next one does", () => {
    expect(
      parseRoutePattern(
        getPatternFromModuleFilePath(
          "/src/routes/posts.$postId.val.ts",
          "/src/routes",
        ),
      ),
    ).toEqual([
      { type: "literal", name: "posts" },
      { type: "string-param", paramName: "postId", optional: false },
    ]);
    expect(
      parseRoutePattern(
        getPatternFromModuleFilePath("/routes/files.$.val.ts", "/routes"),
      ),
    ).toEqual([
      { type: "literal", name: "files" },
      { type: "array-param", paramName: "_splat", optional: false },
    ]);
  });

  test("the Next branch is untouched", () => {
    expect(getPatternFromModuleFilePath("/app/page.val.ts", "/app")).toBe("");
    expect(
      getPatternFromModuleFilePath("/app/blogs/[blog]/page.val.ts", "/app"),
    ).toBe("/blogs/[blog]");
  });

  test("isTanStackRoutesFolder only accepts the two route folders", () => {
    expect(isTanStackRoutesFolder("/routes")).toBe(true);
    expect(isTanStackRoutesFolder("/src/routes")).toBe(true);
    expect(isTanStackRoutesFolder("/app")).toBe(false);
  });
});

describe("getPageRouterSitemapTree with tanstack routes", () => {
  test("builds the same shape of tree from tanstack module paths", () => {
    const sitemap = getPageRouterSitemapTree("/src/routes", [
      { urlPath: "/", moduleFilePath: "/src/routes/index.val.ts" },
      {
        urlPath: "/posts/hello",
        moduleFilePath: "/src/routes/posts.$postId.val.ts",
      },
      {
        urlPath: "/posts/world",
        moduleFilePath: "/src/routes/posts.$postId.val.ts",
      },
    ]);
    expect(sitemap.page).toEqual({ fullPath: "/" });
    expect(sitemap.pattern).toBe("");
    const posts = sitemap.children[0];
    expect(posts.name).toBe("posts");
    // The pattern is what the Studio offers when adding a page here.
    expect(posts.pattern).toBe("/posts/[postId]");
    expect(posts.children.map((child) => child.name)).toEqual([
      "hello",
      "world",
    ]);
  });
});
