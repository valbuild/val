import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { collectMediaModules, excludePathsFromTree } from "./media";

const gallery = (
  mediaType: "files" | "images",
  directory: string,
): SerializedSchema => ({
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
  mediaType,
  directory,
});

/** A gallery whose schema carries no `directory` (the fallback path). */
const galleryWithoutDirectory = (): SerializedSchema => ({
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
  mediaType: "images",
});

const plainRecord: SerializedSchema = {
  type: "record",
  item: { type: "string", opt: false, raw: false },
  opt: false,
};

describe("collectMediaModules", () => {
  test("picks out only the galleries, labelled by directory", () => {
    const media = collectMediaModules(
      {
        ["/content/photos.val.ts" as ModuleFilePath]: gallery(
          "images",
          "/public/val/photos",
        ),
        ["/content/docs.val.ts" as ModuleFilePath]: gallery(
          "files",
          "/public/val/docs",
        ),
        // A record WITHOUT a mediaType marker is an ordinary module and stays
        // in Explorer.
        ["/content/authors.val.ts" as ModuleFilePath]: plainRecord,
      },
      () => undefined,
    );

    expect(media).toStrictEqual([
      {
        moduleFilePath: "/content/docs.val.ts",
        directory: "/public/val/docs",
        mediaType: "files",
        errors: undefined,
      },
      {
        moduleFilePath: "/content/photos.val.ts",
        directory: "/public/val/photos",
        mediaType: "images",
        errors: undefined,
      },
    ]);
  });

  test("a gallery with no directory still gets a row", () => {
    const media = collectMediaModules(
      {
        ["/content/photos.val.ts" as ModuleFilePath]: galleryWithoutDirectory(),
      },
      () => undefined,
    );
    expect(media).toHaveLength(1);
    expect(media[0].directory).toBe("/content/photos.val.ts");
  });
});

describe("excludePathsFromTree", () => {
  test("gallery modules are left out of the explorer tree", () => {
    // Two entry points to one module is confusing, and the Explorer one opens
    // a record of file paths rather than the gallery.
    type Node = {
      name: string;
      fullPath: string;
      isDirectory: boolean;
      children: Node[];
    };
    const root: Node = {
      name: "",
      fullPath: "",
      isDirectory: true,
      children: [
        {
          name: "content",
          fullPath: "/content",
          isDirectory: true,
          children: [
            {
              name: "authors.val.ts",
              fullPath: "/content/authors.val.ts",
              isDirectory: false,
              children: [],
            },
            {
              name: "photos.val.ts",
              fullPath: "/content/photos.val.ts",
              isDirectory: false,
              children: [],
            },
          ],
        },
      ],
    };

    const explorer = excludePathsFromTree(
      root,
      new Set(["/content/photos.val.ts"]),
    );

    const names = explorer.children[0].children.map((child) => child.name);
    expect(names).toStrictEqual(["authors.val.ts"]);
  });
});
