/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { useRenameRecordEntry } from "./useRenameRecordEntry";

/**
 * The patches a rename actually emits, and where it leaves you.
 *
 * This is the shared writer - the page's own toolbar and the Pages panel both
 * come through it - so what it puts in the patch IS what renaming means. The
 * hooks in front of it are tested with this one mocked out, and an end-to-end
 * rename only shows that the row moved, so a wrong `move` path or a referrer
 * rewritten in the wrong module would pass everything else.
 */
const router = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;
const featured = "/content/featured.val.ts" as ModuleFilePath;

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

const mockNavigations: { path: string; replace: boolean }[] = [];
jest.mock("./ValRouter", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: (path: string, options?: { replace?: boolean }) => {
      mockNavigations.push({ path, replace: options?.replace === true });
    },
  }),
}));

const mockStore = {
  loaded: [] as string[],
  retried: [] as string[],
  /** What `entryError` answers - i.e. the entry's fetch failed. */
  entryError: undefined as string | undefined,
  /** What a retry answers. */
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

type RenameArgs = Parameters<ReturnType<typeof useRenameRecordEntry>>[0];

async function rename(args: RenameArgs): Promise<void> {
  const renameRecordEntry = renderHook(() => useRenameRecordEntry()).result
    .current;
  await act(async () => {
    await renameRecordEntry(args);
  });
}

describe("useRenameRecordEntry", () => {
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

  test("moves the entry to the new key and opens it there", async () => {
    await rename({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val-2",
      refs: [],
    });
    expect(mockPatches).toEqual([
      {
        moduleFilePath: router,
        patch: [
          {
            op: "move",
            from: ["/blogs/why-val"],
            path: ["/blogs/why-val-2"],
          },
        ],
      },
    ]);
    // `replace`, because the path that was open no longer exists: a Back to it
    // would be a Back to nothing.
    expect(mockNavigations).toEqual([
      { path: `${router}?p="/blogs/why-val-2"`, replace: true },
    ]);
  });

  // The half a copy does not have to do: every field naming the old key has to
  // be rewritten, in its OWN module, or it is left pointing at nothing.
  test("rewrites each referrer where it lives", async () => {
    await rename({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val-2",
      refs: [`${featured}?p="blog"` as SourcePath],
    });
    expect(mockPatches[1]).toEqual({
      moduleFilePath: featured,
      patch: [{ op: "replace", path: ["blog"], value: "/blogs/why-val-2" }],
    });
  });

  test("refuses to rename an entry onto itself", async () => {
    await rename({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val",
      refs: [],
    });
    expect(mockPatches).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  /**
   * A `.jsonValues()` entry is a marker until its content is loaded, and a
   * `move` moves what is there. Moving the marker is the silent failure: the
   * rename looks like it worked and the renamed page opens on nothing.
   */
  describe("a record that loads its entries on demand", () => {
    test("loads the entry before moving it", async () => {
      await rename({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-2",
        refs: [],
        jsonValues: true,
      });
      expect(mockStore.loaded).toEqual([`${router}#/blogs/why-val`]);
      expect(mockPatches).toHaveLength(1);
    });

    // `loadEntries` resolves either way - a failed fetch is recorded rather
    // than thrown - so awaiting it is not the same as having the content.
    test("retries an entry whose fetch failed, then moves it", async () => {
      mockStore.entryError = "offline";
      await rename({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-2",
        refs: [],
        jsonValues: true,
      });
      expect(mockStore.retried).toEqual([`${router}#/blogs/why-val`]);
      expect(mockPatches).toHaveLength(1);
    });

    test("writes nothing, and says so, when the content never arrives", async () => {
      mockStore.entryError = "offline";
      mockStore.retryResult = { status: "error", message: "offline" };
      await rename({
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-2",
        refs: [`${featured}?p="blog"` as SourcePath],
        jsonValues: true,
      });
      expect(mockPatches).toEqual([]);
      expect(mockNavigations).toEqual([]);
      expect(mockReportError).toHaveBeenCalled();
    });
  });
});
