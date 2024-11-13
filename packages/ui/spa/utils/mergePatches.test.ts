import { ModuleFilePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { mergePatches } from "./mergePatches";

describe("mergePatches", () => {
  test("should work with single patches", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 0,
        },
      ],
    };
    expect(mergePatches(patches)).toEqual([
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 1",
          },
        ],
      },
    ]);
  });

  test("should merge multiple consecutive replaces", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 1,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 2",
            },
          ],
          seqNumber: 2,
        },
      ],
    };

    expect(mergePatches(patches)).toEqual([
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 2", // Merged the latest "replace"
          },
        ],
      },
    ]);
  });

  test("should not merge non-replace operations", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 1,
        },
        {
          patch: [
            {
              op: "add",
              path: ["authors", "1", "name"],
              value: "new author",
            },
          ],
          seqNumber: 2,
        },
      ],
    };

    expect(mergePatches(patches)).toEqual([
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 1",
          },
        ],
      },
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "add",
            path: ["authors", "1", "name"],
            value: "new author",
          },
        ],
      },
    ]);
  });

  test("should handle multiple module file paths", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 1,
        },
      ],
      ["/content/books.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["books", "0", "title"],
              value: "New Book Title",
            },
          ],
          seqNumber: 1,
        },
      ],
    };

    expect(mergePatches(patches)).toEqual([
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 1",
          },
        ],
      },
      {
        path: "/content/books.val.ts",
        patch: [
          {
            op: "replace",
            path: ["books", "0", "title"],
            value: "New Book Title",
          },
        ],
      },
    ]);
  });

  test("should merge multiple replace operations on the same path", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 1,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 2",
            },
          ],
          seqNumber: 2,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 3",
            },
          ],
          seqNumber: 3,
        },
      ],
    };

    expect(mergePatches(patches)).toEqual([
      {
        path: "/content/authors.val.ts",
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 3", // Only the last value should be kept
          },
        ],
      },
    ]);
  });

  test("should merge multiple replace operations on the same path, but skip if ", () => {
    const patches: Record<
      ModuleFilePath,
      { patch: Patch; seqNumber: number }[]
    > = {
      ["/content/authors.val.ts" as ModuleFilePath]: [
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 1",
            },
          ],
          seqNumber: 1,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 2",
            },
          ],
          seqNumber: 2,
        },
        {
          patch: [
            {
              op: "add",
              path: ["authors", "1"],
              value: { name: "test 3" },
            },
          ],
          seqNumber: 3,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "1", "name"],
              value: "test 4",
            },
          ],
          seqNumber: 4,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 5",
            },
          ],
          seqNumber: 5,
        },
        {
          patch: [
            {
              op: "replace",
              path: ["authors", "0", "name"],
              value: "test 6",
            },
          ],
          seqNumber: 6,
        },
      ],
    };

    expect(mergePatches(patches)).toEqual([
      {
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 2",
          },
        ],
        path: "/content/authors.val.ts",
      },
      {
        patch: [
          {
            op: "add",
            path: ["authors", "1"],
            value: {
              name: "test 3",
            },
          },
        ],
        path: "/content/authors.val.ts",
      },
      {
        patch: [
          {
            op: "replace",
            path: ["authors", "1", "name"],
            value: "test 4",
          },
        ],
        path: "/content/authors.val.ts",
      },
      {
        patch: [
          {
            op: "replace",
            path: ["authors", "0", "name"],
            value: "test 6",
          },
        ],
        path: "/content/authors.val.ts",
      },
    ]);
  });
});
