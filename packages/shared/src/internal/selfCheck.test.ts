import {
  Internal,
  initVal,
  modules,
  type ModuleFilePath,
  type SelectorSource,
  type ValModule,
} from "@valbuild/core";
import { SELF_CHECK_VERSION, selfCheck } from "./selfCheck";

const { s, c, config } = initVal();

const valModulesOf = (...defined: ValModule<SelectorSource>[]) =>
  modules(
    config,
    defined.map((module) => ({ def: async () => ({ default: module }) })),
  );

const posts = {
  "post-1": { title: "A title that is longer than ten characters" },
  "post-2": { title: "Short" },
};

describe("selfCheck", () => {
  test("the version a site moves to checks its content with its own rules", async () => {
    // What the site's content was written against...
    const before = c.define(
      "/content/blog.val.ts",
      s.record(s.object({ title: s.string() })),
      posts,
    );
    expect((await selfCheck(valModulesOf(before))).errors).toEqual([]);

    // ...and a release that tightened the rule: the same content, rejected.
    const after = c.define(
      "/content/blog.val.ts",
      s.record(s.object({ title: s.string().maxLength(10) })),
      posts,
    );
    const result = await selfCheck(valModulesOf(after));
    expect(result).toEqual({
      version: SELF_CHECK_VERSION,
      valVersion: Internal.VERSION.core,
      modules: 1,
      errors: [
        {
          moduleFilePath: "/content/blog.val.ts",
          path: ["post-1", "title"],
          message: expect.any(String),
        },
      ],
      repairedOnSave: 0,
    });
  });

  test("the content the site holds now is checked, not what its file held", async () => {
    const blog = c.define(
      "/content/blog.val.ts",
      s.record(s.object({ title: s.string().maxLength(10) })),
      { "post-2": { title: "Short" } },
    );
    const published = { ...posts };
    const result = await selfCheck(valModulesOf(blog), {
      sourceOf: (path) =>
        path === ("/content/blog.val.ts" as ModuleFilePath) ? published : null,
    });
    expect(result.errors.map((error) => error.path)).toEqual([
      ["post-1", "title"],
    ]);
  });

  test("what Val repairs when the content is saved holds nothing back", async () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({ hero: s.image() }),
      // No width, height or mime type: Val reads them from the bytes on save.
      { hero: { path: "/public/val/hero.png" } },
    );
    const result = await selfCheck(valModulesOf(page));
    expect(result.errors).toEqual([]);
    expect(result.repairedOnSave).toBeGreaterThan(0);
  });

  test("a key another module does not have is caught, one it has is not", async () => {
    const authors = c.define(
      "/content/authors.val.ts",
      s.record(s.object({ name: s.string() })),
      { ada: { name: "Ada" } },
    );
    const blogOf = (author: string) =>
      c.define(
        "/content/blog.val.ts",
        s.record(s.object({ author: s.keyOf(authors) })),
        { "post-1": { author } },
      );
    expect(
      (await selfCheck(valModulesOf(authors, blogOf("ada")))).errors,
    ).toEqual([]);
    const missing = await selfCheck(valModulesOf(authors, blogOf("bea")));
    expect(missing.errors).toEqual([
      {
        moduleFilePath: "/content/blog.val.ts",
        path: ["post-1", "author"],
        message: expect.any(String),
      },
    ]);
  });

  test("a module that does not load is reported, and the rest are still checked", async () => {
    const blog = c.define(
      "/content/blog.val.ts",
      s.record(s.object({ title: s.string().maxLength(10) })),
      posts,
    );
    const valModules = modules(config, [
      { def: async () => Promise.reject(new Error("Unexpected token")) },
      { def: async () => ({ default: blog }) },
    ]);
    const result = await selfCheck(valModules);
    expect(result.modules).toBe(2);
    expect(result.errors).toEqual([
      {
        moduleFilePath: null,
        path: [],
        message:
          "Entry 1 of val.modules.ts could not be loaded: Unexpected token",
      },
      {
        moduleFilePath: "/content/blog.val.ts",
        path: ["post-1", "title"],
        message: expect.any(String),
      },
    ]);
  });
});
