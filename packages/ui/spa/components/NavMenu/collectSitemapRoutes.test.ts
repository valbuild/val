import { ModuleFilePath } from "@valbuild/core";
import { collectSitemapRoutes } from "./SitemapSection";
import { SitemapItem } from "./types";

const moduleFilePath = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;

describe("collectSitemapRoutes", () => {
  test("reports each row's own urlPath, not a re-derived one", () => {
    // `urlPath` is set once by transformSitemapNode from the route pattern.
    // The walk used to rebuild it as `parentPath + "/" + item.name`, which is
    // the same string only as long as nothing upstream normalizes or encodes.
    // This tree makes the two disagree on purpose: taking the derivation would
    // report "/blogs/Hello World", taking urlPath reports what the route
    // actually resolves to.
    const sitemap: SitemapItem = {
      name: "/",
      urlPath: "/",
      children: [
        {
          name: "blogs",
          urlPath: "/blogs",
          canAddChild: true,
          moduleFilePath,
          routePattern: [
            { type: "literal", name: "blogs" },
            { type: "string-param", paramName: "blog", optional: false },
          ],
          existingKeys: [],
          keyDescription: "URL slug, lowercase",
          children: [
            {
              name: "Hello World",
              urlPath: "/blogs/hello-world",
              sourcePath:
                '/app/blogs/[blog]/page.val.ts?p="/blogs/hello-world"' as SitemapItem["sourcePath"],
              children: [],
            },
          ],
        },
      ],
    };

    const { routes, existingUrls } = collectSitemapRoutes(sitemap);

    expect(existingUrls).toContain("/blogs/hello-world");
    expect(existingUrls).not.toContain("/blogs/Hello World");

    // And the route it collects carries the key description through, so the
    // new-page form can show the schema author's own explanation.
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      moduleFilePath,
      patternString: "/blogs/[blog]",
      keyDescription: "URL slug, lowercase",
    });
  });
});
