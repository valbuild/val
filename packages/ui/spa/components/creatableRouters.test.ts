import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { collectCreatableRouters } from "./creatableRouters";

const router = (
  routerId: string,
  keyDescription?: string,
): SerializedSchema => ({
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
  router: routerId,
  ...(keyDescription
    ? {
        key: {
          type: "string",
          opt: false,
          raw: false,
          description: keyDescription,
        },
      }
    : {}),
});

describe("collectCreatableRouters", () => {
  test("separates page routers from the external one", () => {
    // The external router's keys are absolute URLs, not route patterns, so it
    // needs a different form - the split is what tells the dropdown which.
    const { pageRouters, externalRouter } = collectCreatableRouters(
      {
        ["/app/blogs/[blog]/page.val.ts" as ModuleFilePath]:
          router("next-app-router"),
        ["/app/docs/[...slug]/page.val.ts" as ModuleFilePath]:
          router("next-app-router"),
        ["/content/external.val.ts" as ModuleFilePath]: router(
          "external-url-router",
        ),
        // Not a router: an ordinary record must not become a create target.
        ["/content/authors.val.ts" as ModuleFilePath]: {
          type: "record",
          item: { type: "string", opt: false, raw: false },
          opt: false,
        },
      },
      {},
    );

    expect(pageRouters.map((r) => r.patternString)).toStrictEqual([
      "/blogs/[blog]",
      "/docs/[...slug]",
    ]);
    expect(externalRouter?.moduleFilePath).toBe("/content/external.val.ts");
  });

  test("carries existing keys and the key description through", () => {
    // Existing keys let the form refuse a duplicate; the description is the
    // schema author's own explanation of what a key should look like.
    const { pageRouters } = collectCreatableRouters(
      {
        ["/app/blogs/[blog]/page.val.ts" as ModuleFilePath]: router(
          "next-app-router",
          "URL slug, lowercase",
        ),
      },
      {
        ["/app/blogs/[blog]/page.val.ts" as ModuleFilePath]: {
          "/blogs/hello": {},
          "/blogs/world": {},
        },
      },
    );

    expect(pageRouters).toHaveLength(1);
    expect(pageRouters[0].existingKeys).toStrictEqual([
      "/blogs/hello",
      "/blogs/world",
    ]);
    expect(pageRouters[0].keyDescription).toBe("URL slug, lowercase");
  });

  test("a project with no routers offers nothing to create", () => {
    const { pageRouters, externalRouter } = collectCreatableRouters({}, {});
    expect(pageRouters).toStrictEqual([]);
    expect(externalRouter).toBeNull();
  });
});
