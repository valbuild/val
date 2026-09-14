import { SerializedSchema, SourcePath } from "@valbuild/core";
import { describePath } from "./describePath";

/**
 * Serialized schemas, written out rather than serialized from `s.array(...)`:
 * `executeSerialize` is protected, and the studio gets these off the wire
 * anyway. Only the fields `describePath` reads matter here.
 */
const stringSchema: SerializedSchema = {
  type: "string",
  raw: false,
  opt: false,
};
const arraySchema: SerializedSchema = {
  type: "array",
  item: stringSchema,
  opt: false,
};
const recordSchema: SerializedSchema = {
  type: "record",
  item: stringSchema,
  opt: false,
};
const objectSchema: SerializedSchema = {
  type: "object",
  items: { heroTitle: stringSchema },
  opt: false,
};
const routerRecordSchema: SerializedSchema = {
  type: "record",
  item: stringSchema,
  opt: false,
  router: "next-app-router",
};

describe("describePath", () => {
  test("a module root falls back to the prettified file name", () => {
    const description = describePath({
      path: "/components/footer.val.ts" as SourcePath,
      schema: arraySchema,
    });
    expect(description.title).toBe("Footer");
    expect(description.origin.title).toBe("fallback");
    expect(description.subtitle).toBe(null);
    expect(description.url).toBe(null);
  });

  test("a module root prefers its schema's preview", () => {
    const description = describePath({
      path: "/components/footer.val.ts" as SourcePath,
      schema: arraySchema,
      preview: { title: "Footer links", subtitle: "2 groups" },
    });
    expect(description.title).toBe("Footer links");
    expect(description.subtitle).toBe("2 groups");
    expect(description.origin.title).toBe("preview");
  });

  test("an array item falls back to #index, never a bare number", () => {
    const description = describePath({
      path: "/components/footer.val.ts?p=1" as SourcePath,
      parentSchema: arraySchema,
    });
    expect(description.title).toBe("#1");
  });

  test("a record entry falls back to the key VERBATIM", () => {
    // Not "Blog 1": a record key is authored data, and prettifying it invents
    // a name that cannot be searched for.
    const description = describePath({
      path: '/content/blogs.val.ts?p="blog_1"' as SourcePath,
      parentSchema: recordSchema,
    });
    expect(description.title).toBe("blog_1");
  });

  test("an object property is prettified", () => {
    const description = describePath({
      path: '/app/page.val.ts?p="heroTitle"' as SourcePath,
      parentSchema: objectSchema,
    });
    expect(description.title).toBe("Hero Title");
  });

  test("a page carries its URL even when a preview names it", () => {
    const described = describePath({
      path: '/app/blogs/[id]/page.val.ts?p="/blogs/launch"' as SourcePath,
      parentSchema: routerRecordSchema,
      preview: { title: "Launching Val 1.0", subtitle: "Fredrik" },
    });
    expect(described.title).toBe("Launching Val 1.0");
    expect(described.url).toBe("/blogs/launch");
  });

  test("a page with no preview is titled by its URL", () => {
    const described = describePath({
      path: '/app/blogs/[id]/page.val.ts?p="/blogs/launch"' as SourcePath,
      parentSchema: routerRecordSchema,
    });
    expect(described.title).toBe("/blogs/launch");
    expect(described.url).toBe("/blogs/launch");
  });

  test("a non-router record entry has no URL", () => {
    const described = describePath({
      path: '/content/blogs.val.ts?p="blog_1"' as SourcePath,
      parentSchema: recordSchema,
    });
    expect(described.url).toBe(null);
  });

  test("an empty preview title falls back rather than drawing a blank", () => {
    // A row created a moment ago has no title yet: `title: val.name` on an
    // empty entry is "". The key is the honest answer, not an empty heading.
    const described = describePath({
      path: '/content/blogs.val.ts?p="blog_1"' as SourcePath,
      parentSchema: recordSchema,
      preview: { title: "   ", subtitle: null },
    });
    expect(described.title).toBe("blog_1");
    expect(described.origin.title).toBe("fallback");
  });

  test("an image comes through, and is null when there is none", () => {
    const image = { path: "/public/val/hero_a1b2c.png" } as const;
    expect(
      describePath({
        path: '/content/blogs.val.ts?p="a"' as SourcePath,
        parentSchema: recordSchema,
        preview: { title: "A", image },
      }).image,
    ).toEqual(image);
    expect(
      describePath({
        path: '/content/blogs.val.ts?p="a"' as SourcePath,
        parentSchema: recordSchema,
        preview: { title: "A" },
      }).image,
    ).toBe(null);
  });
});

describe("describePath: a router record is the page list", () => {
  test("falls back to Pages, the name the nav uses", () => {
    expect(
      describePath({
        path: "/app/blogs/[id]/page.val.ts" as SourcePath,
        schema: routerRecordSchema,
      }).title,
    ).toBe("Pages");
  });

  test("a preview on the router record still wins", () => {
    expect(
      describePath({
        path: "/app/blogs/[id]/page.val.ts" as SourcePath,
        schema: routerRecordSchema,
        preview: { title: "Blog posts", subtitle: "12 published" },
      }).title,
    ).toBe("Blog posts");
  });
});

describe("describePath: pathLabel", () => {
  test("is what the path says, whether or not a preview won", () => {
    const described = describePath({
      path: '/content/blogs.val.ts?p="blog_1"' as SourcePath,
      parentSchema: recordSchema,
      preview: { title: "Launching Val 1.0" },
    });
    expect(described.title).toBe("Launching Val 1.0");
    // Still the key: a search hit leads with the name and keeps this above it,
    // because two hits in one module are told apart by their paths alone.
    expect(described.pathLabel).toBe("blog_1");
  });

  test("equals the title when nothing overrode it", () => {
    const described = describePath({
      path: "/components/footer.val.ts" as SourcePath,
      schema: arraySchema,
    });
    expect(described.pathLabel).toBe("Footer");
    expect(described.title).toBe(described.pathLabel);
  });

  test("a page keeps its route as the path label", () => {
    const described = describePath({
      path: '/app/blogs/[id]/page.val.ts?p="/blogs/launch"' as SourcePath,
      parentSchema: routerRecordSchema,
      preview: { title: "Launching Val 1.0" },
    });
    expect(described.pathLabel).toBe("/blogs/launch");
    expect(described.url).toBe("/blogs/launch");
  });
});
