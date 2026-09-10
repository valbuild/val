import { initVal, Internal, type ModuleFilePath } from "@valbuild/core";
import { getValRouteUrlFromVal, initValRouteFromVal } from "./routeFromVal";

const { s, c } = initVal();
// See useValRoute.draft.test.tsx: a bare initVal() does not expose the routers.
const tanstackRouter = Internal.tanstackRouter;

function routerVal(path: string, source: Record<string, { title: string }>) {
  return c.define(
    path as ModuleFilePath,
    s.router(tanstackRouter, s.string(), s.object({ title: s.string() })),
    source,
  );
}

/** The three things `getValRouteUrlFromVal` is given, read off a module. */
function argsOf(val: ReturnType<typeof routerVal>) {
  return {
    path: Internal.getValPath(val),
    schema: Internal.getSchema(val),
    source: Internal.getSource(val),
  };
}

describe("getValRouteUrlFromVal with the TanStack router", () => {
  test("maps params to the key of a flat route file", () => {
    const val = routerVal("/src/routes/posts.$postId.val.ts", {
      "/posts/hello": { title: "Hello" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      getValRouteUrlFromVal(
        { postId: "hello" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBe("/posts/hello");
  });

  test("directory notation is the same route", () => {
    const val = routerVal("/src/routes/posts/$postId.val.ts", {
      "/posts/hello": { title: "Hello" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      getValRouteUrlFromVal(
        { postId: "hello" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBe("/posts/hello");
  });

  test("a splat param joins its segments", () => {
    const val = routerVal("/src/routes/docs.$.val.ts", {
      "/docs/a/b": { title: "Deep" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      getValRouteUrlFromVal(
        { _splat: "a/b" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBe("/docs/a/b");
    /*
     * The shape `useParams()` actually returns on a `$` route: BOTH names for
     * the same value. Neither may be reported as an unconsumed parameter.
     */
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(
      getValRouteUrlFromVal(
        { _splat: "a/b", "*": "a/b" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBe("/docs/a/b");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    // TanStack hands `_splat` as a string; an array is accepted too.
    expect(
      getValRouteUrlFromVal(
        { _splat: ["a", "b"] },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBe("/docs/a/b");
  });

  test("the index route resolves to /", () => {
    const val = routerVal("/src/routes/index.val.ts", {
      "/": { title: "Home" },
    });
    const { path, schema, source } = argsOf(val);
    expect(getValRouteUrlFromVal({}, "useValRoute", path, schema, source)).toBe(
      "/",
    );
  });

  test("a module outside routes/ is refused", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const val = routerVal("/content/pages.val.ts", { "/": { title: "Home" } });
    const { path, schema, source } = argsOf(val);
    expect(
      getValRouteUrlFromVal({}, "useValRoute", path, schema, source),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("/routes or /src/routes"),
    );
    error.mockRestore();
  });

  test("a missing param is refused rather than guessed", () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    const val = routerVal("/src/routes/posts.$postId.val.ts", {
      "/posts/hello": { title: "Hello" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      getValRouteUrlFromVal({}, "useValRoute", path, schema, source),
    ).toBeNull();
    error.mockRestore();
  });
});

describe("initValRouteFromVal", () => {
  test("returns the entry at the resolved url", () => {
    const val = routerVal("/src/routes/posts.$postId.val.ts", {
      "/posts/hello": { title: "Hello" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      initValRouteFromVal(
        { postId: "hello" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toEqual({ title: "Hello" });
  });

  test("returns null for a route the module has no entry for", () => {
    const val = routerVal("/src/routes/posts.$postId.val.ts", {
      "/posts/hello": { title: "Hello" },
    });
    const { path, schema, source } = argsOf(val);
    expect(
      initValRouteFromVal(
        { postId: "missing" },
        "useValRoute",
        path,
        schema,
        source,
      ),
    ).toBeNull();
  });
});
