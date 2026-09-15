/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { useDuplicateRecordEntry } from "./useDuplicateRecordEntry";

/**
 * The patch a duplicate emits, and the entry it refuses to copy.
 *
 * `useRenameRecordEntry.test.tsx`'s sibling, and it exists for the same reason:
 * this is the shared writer - the entry's own toolbar and the Pages panel both
 * come through it - so what it puts in the patch IS what duplicating means.
 */
const router = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;

const mockPatches: { moduleFilePath: ModuleFilePath; patch: Patch }[] = [];
const mockReportError = jest.fn();
jest.mock("./ValProvider", () => ({
  __esModule: true,
  useAddModuleFilePatch: () => ({
    addModuleFilePatch: (moduleFilePath: ModuleFilePath, patch: Patch) => {
      mockPatches.push({ moduleFilePath, patch });
    },
  }),
  useReportError: () => mockReportError,
}));

const mockNavigations: string[] = [];
jest.mock("./ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: (path: string) => {
      mockNavigations.push(path);
    },
  }),
}));

const mockStore = {
  loaded: [] as string[],
  retried: [] as string[],
  /** What `entryError` answers - i.e. the entry's fetch failed. */
  entryError: undefined as string | undefined,
  retryResult: { status: "ok" } as
    | { status: "ok" }
    | { status: "error"; message: string },
};
jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => ({
    system: {
      sourceStore: {
        loadEntries: (moduleFilePath: ModuleFilePath, keys: string[]) => {
          mockStore.loaded.push(`${moduleFilePath}#${keys.join(",")}`);
          return Promise.resolve();
        },
        entryError: () => mockStore.entryError,
        retryEntry: (moduleFilePath: ModuleFilePath, key: string) => {
          mockStore.retried.push(`${moduleFilePath}#${key}`);
          return Promise.resolve(mockStore.retryResult);
        },
      },
    },
  }),
}));

type DuplicateArgs = Parameters<ReturnType<typeof useDuplicateRecordEntry>>[0];

async function duplicate(args: DuplicateArgs): Promise<void> {
  const duplicateRecordEntry = renderHook(() => useDuplicateRecordEntry())
    .result.current;
  await act(async () => {
    await duplicateRecordEntry(args);
  });
}

describe("useDuplicateRecordEntry", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    mockPatches.length = 0;
    mockNavigations.length = 0;
    mockReportError.mockClear();
    mockStore.loaded = [];
    mockStore.retried = [];
    mockStore.entryError = undefined;
    mockStore.retryResult = { status: "ok" };
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("copies the entry to the new key and opens the copy", async () => {
    await duplicate({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val-copy",
    });
    expect(mockPatches).toEqual([
      {
        moduleFilePath: router,
        patch: [
          {
            op: "copy",
            from: ["/blogs/why-val"],
            path: ["/blogs/why-val-copy"],
          },
        ],
      },
    ]);
    // Into the copy, not left looking at the original: duplicating a page is
    // the first half of editing one.
    expect(mockNavigations).toEqual([`${router}?p="/blogs/why-val-copy"`]);
  });

  test("refuses to duplicate an entry onto itself", async () => {
    await duplicate({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val",
    });
    expect(mockPatches).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  /**
   * A `.jsonValues()` entry is a marker until its content is loaded, and a
   * `copy` copies what is there. Copying the marker is the silent failure: the
   * duplicate looks like it worked and the copy opens on nothing.
   */
  describe("a record that loads its entries on demand", () => {
    test("loads the entry before copying it", async () => {
      await duplicate({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-copy",
        jsonValues: true,
      });
      expect(mockStore.loaded).toEqual([`${router}#/blogs/why-val`]);
      expect(mockPatches).toHaveLength(1);
    });

    // `loadEntries` resolves either way - a failed fetch is recorded rather
    // than thrown, and a key that failed before is skipped - so awaiting it is
    // not the same as having the content.
    test("retries an entry whose fetch failed, then copies it", async () => {
      mockStore.entryError = "offline";
      await duplicate({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-copy",
        jsonValues: true,
      });
      expect(mockStore.retried).toEqual([`${router}#/blogs/why-val`]);
      expect(mockPatches).toHaveLength(1);
    });

    test("writes nothing, and says so, when the content never arrives", async () => {
      mockStore.entryError = "offline";
      mockStore.retryResult = { status: "error", message: "offline" };
      await duplicate({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-copy",
        jsonValues: true,
      });
      expect(mockPatches).toEqual([]);
      expect(mockNavigations).toEqual([]);
      expect(mockReportError).toHaveBeenCalled();
    });
  });
});
