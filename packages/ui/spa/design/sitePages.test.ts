import { initVal, Internal, type Json } from "@valbuild/core";
import { sitePages } from "./sitePages";

const { s } = initVal();

describe("the site's pages", () => {
  test("are the keys of its page routers, / first, and nothing else", () => {
    const pages = s
      .record(s.object({ title: s.string() }))
      .router(Internal.tanstackRouter)
      ["executeSerialize"]();
    const notPages = s
      .record(s.object({ title: s.string() }))
      ["executeSerialize"]();
    const sources: Record<string, Json> = {
      "/src/routes/_site.products.$sku.val.ts": {
        "/products/b": { title: "B" },
        "/products/a": { title: "A" },
      },
      "/src/routes/_site.index.val.ts": { "/": { title: "Home" } },
      "/content/authors.val.ts": { ada: { title: "Ada" } },
    };
    expect(
      sitePages(
        {
          "/src/routes/_site.products.$sku.val.ts": pages,
          "/src/routes/_site.index.val.ts": pages,
          "/content/authors.val.ts": notPages,
        },
        sources,
      ),
    ).toEqual(["/", "/products/a", "/products/b"]);
  });
});
