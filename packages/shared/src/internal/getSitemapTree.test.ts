import { ModuleFilePath } from "@valbuild/core";
import { getNextAppRouterSitemapTree } from "./getSitemapTree";

describe("getNextAppRouterSitemapTree", () => {
  it("should build a complex sitemap tree with various route types", () => {
    const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [
      {
        urlPath: "/foo",
        moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/one",
        moduleFilePath: "/app/bar/[test]/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/two",
        moduleFilePath: "/app/bar/[test]/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/zed/dead",
        moduleFilePath: "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/zed/lead/dead",
        moduleFilePath: "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/zed/lead/dead/bled",
        moduleFilePath: "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
      },
    ];

    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
          sourcePath: '/app/foo/page.val.ts?p="/foo"',
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]",
          moduleFilePath: "/app/bar/[test]/page.val.ts" as ModuleFilePath,
          children: [
            {
              type: "leaf",
              name: "one",
              pattern: "/bar/[test]",
              fullPath: "/bar/one",
              moduleFilePath: "/app/bar/[test]/page.val.ts" as ModuleFilePath,
              sourcePath: '/app/bar/[test]/page.val.ts?p="/bar/one"',
              children: [],
            },
            {
              type: "leaf",
              name: "two",
              pattern: "/bar/[test]",
              fullPath: "/bar/two",
              moduleFilePath: "/app/bar/[test]/page.val.ts" as ModuleFilePath,
              sourcePath: '/app/bar/[test]/page.val.ts?p="/bar/two"',
              children: [],
            },
          ],
        },
        {
          type: "node",
          name: "zed",
          pattern: "/zed/[[...path]]",
          moduleFilePath: "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
          children: [
            {
              type: "leaf",
              name: "dead",
              pattern: "/zed/[[...path]]",
              fullPath: "/zed/dead",
              moduleFilePath:
                "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
              sourcePath: '/app/zed/[[...path]]/page.val.ts?p="/zed/dead"',
              children: [],
            },
            {
              type: "node",
              name: "lead",
              pattern: "/zed/[[...path]]",
              moduleFilePath:
                "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
              children: [
                {
                  type: "node",
                  name: "dead",
                  pattern: "/zed/[[...path]]",
                  page: {
                    fullPath: "/zed/lead/dead",
                  },
                  sourcePath:
                    '/app/zed/[[...path]]/page.val.ts?p="/zed/lead/dead"',
                  moduleFilePath:
                    "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
                  children: [
                    {
                      type: "leaf",
                      name: "bled",
                      pattern: "/zed/[[...path]]",
                      fullPath: "/zed/lead/dead/bled",
                      sourcePath:
                        '/app/zed/[[...path]]/page.val.ts?p="/zed/lead/dead/bled"',
                      moduleFilePath:
                        "/app/zed/[[...path]]/page.val.ts" as ModuleFilePath,
                      children: [],
                    },
                  ],
                  isLinear: true,
                },
              ],
              isLinear: true,
            },
          ],
        },
      ],
    });
  });

  it("should handle shared sub-paths under dynamic routes", () => {
    const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [
      {
        urlPath: "/foo",
        moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/one/sub",
        moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/two/sub",
        moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
      },
    ];

    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
          sourcePath: '/app/foo/page.val.ts?p="/foo"',
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]/sub",
          moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
          children: [
            {
              type: "node",
              name: "one",
              pattern: "/bar/[test]/sub",
              moduleFilePath:
                "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/one/sub",
                  sourcePath:
                    '/app/bar/[test]/sub/page.val.ts?p="/bar/one/sub"',
                  moduleFilePath:
                    "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
                  children: [],
                },
              ],
              isLinear: true,
            },
            {
              type: "node",
              name: "two",
              pattern: "/bar/[test]/sub",
              moduleFilePath:
                "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/two/sub",
                  sourcePath:
                    '/app/bar/[test]/sub/page.val.ts?p="/bar/two/sub"',
                  moduleFilePath:
                    "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
                  children: [],
                },
              ],
              isLinear: true,
            },
          ],
        },
      ],
    });
  });

  it("should handle a root page alongside other complex routes", () => {
    const paths: { urlPath: string; moduleFilePath: ModuleFilePath }[] = [
      {
        urlPath: "/",
        moduleFilePath: "/app/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/foo",
        moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/one/sub",
        moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/bar/two/sub",
        moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
      },
    ];

    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
          sourcePath: '/app/foo/page.val.ts?p="/foo"',
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]/sub",
          moduleFilePath: "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
          children: [
            {
              type: "node",
              name: "one",
              pattern: "/bar/[test]/sub",
              moduleFilePath:
                "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/one/sub",
                  sourcePath:
                    '/app/bar/[test]/sub/page.val.ts?p="/bar/one/sub"',
                  moduleFilePath:
                    "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
                  children: [],
                },
              ],
              isLinear: true,
            },
            {
              type: "node",
              name: "two",
              pattern: "/bar/[test]/sub",
              moduleFilePath:
                "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/two/sub",
                  sourcePath:
                    '/app/bar/[test]/sub/page.val.ts?p="/bar/two/sub"',
                  moduleFilePath:
                    "/app/bar/[test]/sub/page.val.ts" as ModuleFilePath,
                  children: [],
                },
              ],
              isLinear: true,
            },
          ],
        },
      ],
      pattern: "",
      page: {
        fullPath: "/",
      },
      sourcePath: "/app/page.val.ts?p=/",
      moduleFilePath: "/app/page.val.ts" as ModuleFilePath,
    });
  });

  it("should handle root page", () => {
    const paths = [
      { urlPath: "/", moduleFilePath: "/app/page.val.ts" as ModuleFilePath },
    ];
    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toStrictEqual({
      type: "node",
      name: "/",
      children: [],
      pattern: "",
      page: {
        fullPath: "/",
      },
      sourcePath: "/app/page.val.ts?p=/",
      moduleFilePath: "/app/page.val.ts" as ModuleFilePath,
    });
  });

  it("should handle a folder that is also a page", () => {
    const paths = [
      {
        urlPath: "/foo/bar",
        moduleFilePath: "/app/foo/bar/page.val.ts" as ModuleFilePath,
      },
      {
        urlPath: "/foo",
        moduleFilePath: "/app/foo/page.val.ts" as ModuleFilePath,
      },
    ];
    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "node",
          name: "foo",
          pattern: "/foo/bar",
          moduleFilePath: "/app/foo/bar/page.val.ts" as ModuleFilePath,
          children: [
            {
              type: "leaf",
              name: "bar",
              pattern: "/foo/bar",
              fullPath: "/foo/bar",
              sourcePath: '/app/foo/bar/page.val.ts?p="/foo/bar"',
              moduleFilePath: "/app/foo/bar/page.val.ts" as ModuleFilePath,
              children: [],
            },
          ],
          isLinear: true,
        },
      ],
      isLinear: true,
    });
  });

  it("should ignore route groups", () => {
    const paths = [
      {
        urlPath: "/foo",
        moduleFilePath: "/app/(main)/foo/page.val.ts" as ModuleFilePath,
      },
    ];
    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    expect(sitemap).toStrictEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          sourcePath: '/app/(main)/foo/page.val.ts?p="/foo"',
          moduleFilePath: "/app/(main)/foo/page.val.ts" as ModuleFilePath,
          children: [],
        },
      ],
      isLinear: true,
    });
  });
});
