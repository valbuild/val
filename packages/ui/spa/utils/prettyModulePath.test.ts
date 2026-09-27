import { prettyModuleLocation, prettyModulePath } from "./prettyModulePath";

/**
 * The two spellings of a location, pinned on the paths that motivated them.
 *
 * `[blog]` is the one that would otherwise reach an editor verbatim — it is a
 * Next convention, and the Studio's Pages panel already reads it as `Blog`.
 */
describe("prettyModulePath", () => {
  test("strips the extension and prettifies every segment", () => {
    expect(prettyModulePath("/content/authors.val.ts")).toBe(
      "Content / Authors",
    );
    expect(prettyModulePath("/app/blogs/[blog]/page.val.ts")).toBe(
      "App / Blogs / Blog / Page",
    );
    expect(prettyModulePath("/app/(marketing)/page.val.ts")).toBe(
      "App / Marketing / Page",
    );
  });

  test("a module at the root is just its name", () => {
    expect(prettyModulePath("/page.val.ts")).toBe("Page");
  });
});

describe("prettyModuleLocation", () => {
  test("is the folders, without the module itself", () => {
    expect(prettyModuleLocation("/content/authors.val.ts")).toBe("Content");
    expect(prettyModuleLocation("/app/blogs/[blog]/page.val.ts")).toBe(
      "App / Blogs / Blog",
    );
  });

  test("is null at the root, so a caller renders nothing", () => {
    expect(prettyModuleLocation("/page.val.ts")).toBe(null);
  });
});
