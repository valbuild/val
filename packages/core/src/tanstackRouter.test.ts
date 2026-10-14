import {
  parseTanStackRoutePattern,
  tanstackRouter,
  validateUrlAgainstPattern,
  matchRoutePattern,
} from "./router";
import { ModuleFilePath } from "./val";
import { getSourcePathFromRoute } from "./getSourcePathFromRoute";
import { initSchema } from "./initSchema";

const s = initSchema();

describe("parseTanStackRoutePattern", () => {
  test.each<[string, string[]]>([
    // The root route: no segments, which is not the same as "not a route".
    ["/src/routes/index.val.ts", []],
    ["/routes/index.val.ts", []],
    ["/src/routes/about.val.ts", ["about"]],
    // Flat and directory notation are the same route.
    ["/src/routes/posts.$postId.val.ts", ["posts", "[postId]"]],
    ["/src/routes/posts/$postId.val.ts", ["posts", "[postId]"]],
    ["/src/routes/posts/$postId/index.val.ts", ["posts", "[postId]"]],
    // `route` is a directory's layout, so it serves the directory's own path.
    ["/src/routes/posts/route.val.ts", ["posts"]],
    // A splat, named the way TanStack names the param.
    ["/src/routes/files.$.val.ts", ["files", "[..._splat]"]],
    // Route groups and pathless layouts are not in the URL.
    ["/src/routes/(marketing)/about.val.ts", ["about"]],
    ["/src/routes/_layout.dashboard.val.ts", ["dashboard"]],
    ["/src/routes/_layout/dashboard.val.ts", ["dashboard"]],
    // A trailing underscore opts out of nesting; the URL keeps the name.
    ["/src/routes/posts_.$postId.edit.val.ts", ["posts", "[postId]", "edit"]],
    // .tsx / .js module files are routes too.
    ["/src/routes/posts.$postId.val.tsx", ["posts", "[postId]"]],
    ["/routes/posts.$postId.val.js", ["posts", "[postId]"]],
  ])("%s -> %p", (moduleFilePath, expected) => {
    expect(parseTanStackRoutePattern(moduleFilePath)).toEqual(expected);
  });

  test("a path that is not under routes/ has no pattern", () => {
    expect(parseTanStackRoutePattern("/content/authors.val.ts")).toEqual([]);
    // NOTE: this is the same answer as the root route. A module that is not a
    // route never reaches the router (the schema decides that), so the
    // ambiguity is not observable — see getSourcePathFromRoute, which only
    // looks at modules whose schema declares a router.
    expect(parseTanStackRoutePattern("")).toEqual([]);
  });
});

describe("tanstackRouter.validate", () => {
  test("accepts keys that match the pattern", () => {
    expect(
      tanstackRouter.validate(
        "/src/routes/posts.$postId.val.ts" as ModuleFilePath,
        ["/posts/hello-world", "/posts/another"],
      ),
    ).toEqual([]);
  });

  test("rejects a key with the wrong literal segment", () => {
    const errors = tanstackRouter.validate(
      "/src/routes/posts.$postId.val.ts" as ModuleFilePath,
      ["/articles/hello-world"],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].error.expectedPath).toBe("/posts/[postId]");
  });

  test("rejects a key with too many segments", () => {
    const errors = tanstackRouter.validate(
      "/src/routes/posts.$postId.val.ts" as ModuleFilePath,
      ["/posts/a/b"],
    );
    expect(errors).toHaveLength(1);
  });

  test("a splat matches any number of trailing segments", () => {
    expect(
      tanstackRouter.validate("/src/routes/files.$.val.ts" as ModuleFilePath, [
        "/files/a",
        "/files/a/b/c",
      ]),
    ).toEqual([]);
  });

  test("the root route only matches /", () => {
    expect(
      tanstackRouter.validate("/src/routes/index.val.ts" as ModuleFilePath, [
        "/",
      ]),
    ).toEqual([]);
    expect(
      tanstackRouter.validate("/src/routes/index.val.ts" as ModuleFilePath, [
        "/about",
      ]),
    ).toHaveLength(1);
  });

  test("the router id is what the schema serializes", () => {
    const schema = s
      .record(s.object({ title: s.string() }))
      .router(tanstackRouter);
    expect(schema["executeSerialize"]().router).toBe("tanstack-router");
  });
});

describe("getSourcePathFromRoute with a tanstack router", () => {
  const schemas = {
    ["/src/routes/posts.$postId.val.ts" as ModuleFilePath]: s
      .record(s.object({ title: s.string() }))
      .router(tanstackRouter)
      ["executeSerialize"](),
    ["/content/authors.val.ts" as ModuleFilePath]: s
      .record(s.object({ name: s.string() }))
      ["executeSerialize"](),
  };

  test("resolves a pathname to the module that serves it", () => {
    expect(getSourcePathFromRoute("/posts/hello", schemas)).toEqual({
      moduleFilePath: "/src/routes/posts.$postId.val.ts",
      sourcePath: '/src/routes/posts.$postId.val.ts?p="/posts/hello"',
      route: "/posts/hello",
    });
  });

  test("returns null when nothing serves the pathname", () => {
    expect(getSourcePathFromRoute("/nope/at/all", schemas)).toBeNull();
  });
});

describe("validateUrlAgainstPattern is shared with the Next router", () => {
  test("the tanstack parser produces patterns it understands", () => {
    expect(
      validateUrlAgainstPattern(
        "/posts/hello",
        parseTanStackRoutePattern("/src/routes/posts/$postId.val.ts"),
      ).isValid,
    ).toBe(true);
  });
});

describe("optional segments", () => {
  test("{-$param} is an optional segment", () => {
    expect(
      parseTanStackRoutePattern(
        "/src/routes/_site.{-$locale}.blog.$slug.val.ts",
      ),
    ).toEqual(["[[locale]]", "blog", "[slug]"]);
  });

  test("a URL may leave an optional segment out, even when it is not last", () => {
    const pattern = ["[[locale]]", "blog", "[slug]"];
    expect(matchRoutePattern("/blog/hello", pattern)).toEqual({
      locale: null,
      slug: "hello",
    });
    expect(matchRoutePattern("/nb/blog/hei", pattern)).toEqual({
      locale: "nb",
      slug: "hei",
    });
    expect(matchRoutePattern("/nb/hei", pattern)).toBeNull();
    expect(matchRoutePattern("/nb/no/blog/hei", pattern)).toBeNull();
  });

  test("an optional segment is not an optional catch-all", () => {
    expect(validateUrlAgainstPattern("/a/b", ["[[x]]"]).isValid).toBe(false);
    expect(validateUrlAgainstPattern("/a/b", ["[[...x]]"]).isValid).toBe(true);
    expect(validateUrlAgainstPattern("/", ["[[x]]"]).isValid).toBe(true);
  });

  test("the router validates keys with and without the segment", () => {
    expect(
      tanstackRouter.validate(
        "/src/routes/_site.{-$locale}.blog.$slug.val.ts" as ModuleFilePath,
        ["/blog/hello", "/nb/blog/hei"],
      ),
    ).toEqual([]);
  });

  test("a catch-all is joined the way the key writes it", () => {
    expect(matchRoutePattern("/docs/a/b", ["docs", "[...slug]"])).toEqual({
      slug: "a/b",
    });
    expect(matchRoutePattern("/docs", ["docs", "[[...slug]]"])).toEqual({
      slug: null,
    });
  });
});
