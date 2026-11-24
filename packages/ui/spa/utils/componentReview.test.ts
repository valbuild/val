import {
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import {
  componentPreviewUrl,
  contentLabelOf,
  pageRouteOf,
} from "./componentReview";

describe("componentPreviewUrl", () => {
  test("the path in the query, and the example by name when asked", () => {
    const path = '/page.val.ts?p="sections".0' as SourcePath;
    const url = new URL(componentPreviewUrl(path, "longTitle"), "http://site");
    expect(url.pathname).toBe("/val-preview");
    expect(url.searchParams.get("p")).toBe(path);
    expect(url.searchParams.get("example")).toBe("longTitle");
    expect(
      new URL(componentPreviewUrl(path, null), "http://site").searchParams.has(
        "example",
      ),
    ).toBe(false);
  });
});

describe("pageRouteOf", () => {
  test("the route of a page router's entry, and null otherwise", () => {
    const schemas: Record<ModuleFilePath, SerializedSchema> = {
      ["/pages.val.ts" as ModuleFilePath]: {
        type: "record",
        item: { type: "object", items: {}, opt: false },
        opt: false,
        router: "next-app-router",
      },
      ["/plain.val.ts" as ModuleFilePath]: {
        type: "record",
        item: { type: "object", items: {}, opt: false },
        opt: false,
      },
    };
    expect(
      pageRouteOf(
        '/pages.val.ts?p="/blog/a"."sections".0' as SourcePath,
        schemas,
      ),
    ).toBe("/blog/a");
    expect(pageRouteOf('/plain.val.ts?p="a"' as SourcePath, schemas)).toBe(
      null,
    );
    expect(pageRouteOf("/missing.val.ts" as SourcePath, schemas)).toBe(null);
  });
});

describe("contentLabelOf", () => {
  test("the first string that is written, not the kind", () => {
    expect(contentLabelOf({ type: "hero", title: "Ship content" })).toBe(
      "Ship content",
    );
    expect(contentLabelOf({ count: 3 })).toBe(null);
    expect(contentLabelOf(null)).toBe(null);
    expect(contentLabelOf({ text: "x".repeat(100) })?.length).toBe(80);
  });
});
