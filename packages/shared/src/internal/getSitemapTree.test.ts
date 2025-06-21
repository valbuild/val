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
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]",
          children: [
            {
              type: "leaf",
              name: "one",
              pattern: "/bar/[test]",
              fullPath: "/bar/one",
              children: [],
            },
            {
              type: "leaf",
              name: "two",
              pattern: "/bar/[test]",
              fullPath: "/bar/two",
              children: [],
            },
          ],
        },
        {
          type: "node",
          name: "zed",
          pattern: "/zed/[[...path]]",
          children: [
            {
              type: "leaf",
              name: "dead",
              pattern: "/zed/[[...path]]",
              fullPath: "/zed/dead",
              children: [],
            },
            {
              type: "node",
              name: "lead",
              pattern: "/zed/[[...path]]",
              children: [
                {
                  type: "node",
                  name: "dead",
                  pattern: "/zed/[[...path]]",
                  page: {
                    fullPath: "/zed/lead/dead",
                  },
                  children: [
                    {
                      type: "leaf",
                      name: "bled",
                      pattern: "/zed/[[...path]]",
                      fullPath: "/zed/lead/dead/bled",
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
    expect(sitemap).toEqual({
      type: "node",
      name: "/",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]/sub",
          page: {
            fullPath: "/bar",
          },
          children: [
            {
              type: "node",
              name: "one",
              pattern: "/bar/[test]/sub",
              page: {
                fullPath: "/bar/one",
              },
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/one/sub",
                  children: [],
                },
              ],
              isLinear: true,
            },
            {
              type: "node",
              name: "two",
              pattern: "/bar/[test]/sub",
              page: {
                fullPath: "/bar/two",
              },
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/two/sub",
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
      page: {
        fullPath: "/",
      },
      pattern: "",
      children: [
        {
          type: "leaf",
          name: "foo",
          pattern: "/foo",
          fullPath: "/foo",
          children: [],
        },
        {
          type: "node",
          name: "bar",
          pattern: "/bar/[test]/sub",
          page: {
            fullPath: "/bar",
          },
          children: [
            {
              type: "node",
              name: "one",
              pattern: "/bar/[test]/sub",
              page: {
                fullPath: "/bar/one",
              },
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/one/sub",
                  children: [],
                },
              ],
              isLinear: true,
            },
            {
              type: "node",
              name: "two",
              pattern: "/bar/[test]/sub",
              page: {
                fullPath: "/bar/two",
              },
              children: [
                {
                  type: "leaf",
                  name: "sub",
                  pattern: "/bar/[test]/sub",
                  fullPath: "/bar/two/sub",
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

  it("should handle root page", () => {
    const paths = [
      { urlPath: "/", moduleFilePath: "/app/page.val.ts" as ModuleFilePath },
    ];
    const sitemap = getNextAppRouterSitemapTree("/app", paths);
    console.log(JSON.stringify(sitemap, null, 2));
    expect(sitemap).toStrictEqual({
      type: "node",
      name: "/",
      page: {
        fullPath: "/",
      },
      pattern: "",
      children: [],
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
          page: {
            fullPath: "/foo",
          },
          children: [
            {
              type: "leaf",
              name: "bar",
              pattern: "/foo/bar",
              fullPath: "/foo/bar",
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
          children: [],
        },
      ],
      isLinear: true,
    });
  });
});
