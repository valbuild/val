/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { useRenamePage } from "./useRenamePage";
import { RenameRecordEntry } from "./useRenameRecordEntry";

/**
 * What a rename from the Pages panel has to get right before it writes.
 *
 * The move itself is `useRenameRecordEntry`'s - shared with the entry's own
 * toolbar - so what is this hook's own is everything in front of it: the schema
 * refusals, and the reference scan. A rename moves the page out from under
 * everything linking to it, and a scan is blind to `.jsonValues()` entry content
 * that has not been loaded, so "load first, then scan, then write, and refuse if
 * the load did not finish" is the whole behaviour worth testing.
 */
const router = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;
const featured = "/content/featured.val.ts" as ModuleFilePath;

const routerSchema: SerializedSchema = {
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
  router: "next-app-router",
};
/** One `keyOf` field naming the page's key, and one `route` field carrying its URL. */
const featuredSchema: SerializedSchema = {
  type: "object",
  opt: false,
  items: {
    blog: {
      type: "keyOf",
      path: router as unknown as SourcePath,
      opt: false,
      values: "string",
    },
    link: { type: "route", opt: false },
  },
};

const mockSchemas = {
  current: { status: "success", data: {} } as {
    status: string;
    data?: Record<string, SerializedSchema>;
  },
};
jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemas: () => mockSchemas.current,
}));

const mockReportError = jest.fn();
jest.mock("./ValProvider", () => ({
  __esModule: true,
  useReportError: () => mockReportError,
}));

type RenameArgs = Parameters<RenameRecordEntry>[0];
const mockRenameCalls: RenameArgs[] = [];
jest.mock("./useRenameRecordEntry", () => ({
  __esModule: true,
  useRenameRecordEntry: () => (args: RenameArgs) => {
    mockRenameCalls.push(args);
    return Promise.resolve();
  },
}));

type EntriesStatus = {
  status: "complete" | "incomplete" | "error";
  errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
};
const mockStore = {
  sources: {} as Record<ModuleFilePath, Source>,
  entriesStatus: { status: "complete", errors: [] } as EntriesStatus,
  loaded: [] as ModuleFilePath[],
};
jest.mock("../stores/react/SystemContext", () => ({
  __esModule: true,
  useValSystem: () => ({
    system: {
      sourceStore: {
        allSources: () => mockStore.sources,
        entriesStatus: () => mockStore.entriesStatus,
        loadAllEntries: (moduleFilePath: ModuleFilePath) => {
          mockStore.loaded.push(moduleFilePath);
          return Promise.resolve();
        },
      },
    },
  }),
}));

/** The refs the one rename that happened was handed. */
function renamedRefs(): SourcePath[] {
  const call = mockRenameCalls[0];
  if (call === undefined) {
    throw new Error("expected a rename, but none happened");
  }
  return call.refs;
}

function renamePage() {
  return renderHook(() => useRenamePage()).result.current;
}

/** The hook loads and scans before it writes, so the write lands a tick later. */
async function rename(from: string, to: string) {
  const fn = renamePage();
  await act(async () => {
    fn(router, from, to);
  });
}

describe("useRenamePage", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    mockRenameCalls.length = 0;
    mockReportError.mockClear();
    mockStore.loaded = [];
    mockStore.entriesStatus = { status: "complete", errors: [] };
    mockSchemas.current = {
      status: "success",
      data: { [router]: routerSchema },
    };
    mockStore.sources = { [router]: { "/blogs/why-val": {} } };
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("moves the entry, and says the record loads on demand when it does", async () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: { ...routerSchema, jsonValues: true } },
    };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(mockRenameCalls).toEqual([
      {
        parentPath: router,
        fromKey: "/blogs/why-val",
        toKey: "/blogs/why-val-2",
        refs: [],
        jsonValues: true,
      },
    ]);
  });

  test("a record that holds its entries inline is not loaded first", async () => {
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(mockRenameCalls).toEqual([
      expect.objectContaining({ jsonValues: false }),
    ]);
  });

  // Both kinds of referrer, since a page key has two: a `keyOf` field naming
  // the key, and a `route` field carrying the URL as its value.
  test("hands the write every field pointing at the old URL", async () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: routerSchema, [featured]: featuredSchema },
    };
    mockStore.sources = {
      [router]: { "/blogs/why-val": {}, "/blogs/hello": {} },
      [featured]: { blog: "/blogs/why-val", link: "/blogs/why-val" },
    };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(renamedRefs().sort()).toEqual(
      [`${featured}?p="blog"`, `${featured}?p="link"`].sort(),
    );
  });

  test("leaves a field pointing at another page alone", async () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: routerSchema, [featured]: featuredSchema },
    };
    mockStore.sources = {
      [router]: { "/blogs/why-val": {}, "/blogs/hello": {} },
      [featured]: { blog: "/blogs/hello", link: "/blogs/hello" },
    };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(renamedRefs()).toEqual([]);
  });

  /**
   * The load the scan depends on, and the refusal when it does not finish.
   *
   * A jsonValues record whose item schema points OUTWARD - here a `route` field,
   * which is matched by value and so forces every such record to be loaded - is
   * the only content a scan for referrers can be blind to.
   */
  describe("when a record loads its entries on demand", () => {
    const linkers = "/content/linkers.val.ts" as ModuleFilePath;
    beforeEach(() => {
      mockSchemas.current = {
        status: "success",
        data: {
          [router]: routerSchema,
          [linkers]: {
            type: "record",
            opt: false,
            jsonValues: true,
            item: {
              type: "object",
              opt: false,
              items: { link: { type: "route", opt: false } },
            },
          },
        },
      };
      mockStore.sources = {
        [router]: { "/blogs/why-val": {} },
        [linkers]: { one: { link: "/blogs/why-val" } },
      };
    });

    test("loads its content before scanning for referrers", async () => {
      await rename("/blogs/why-val", "/blogs/why-val-2");
      expect(mockStore.loaded).toEqual([linkers]);
      expect(renamedRefs()).toEqual([`${linkers}?p="one"."link"`]);
    });

    // Renaming on a half-loaded scan rewrites the referrers that happen to be
    // there and leaves the rest pointing at a URL that is about to stop
    // existing. There is no half-way version of that to offer.
    test("refuses, visibly, when that content could not be loaded", async () => {
      mockStore.entriesStatus = {
        status: "error",
        errors: [{ moduleFilePath: linkers, key: "one", message: "offline" }],
      };
      await rename("/blogs/why-val", "/blogs/why-val-2");
      expect(mockRenameCalls).toEqual([]);
      expect(mockReportError).toHaveBeenCalled();
    });
  });

  test("refuses while the schemas are still loading, rather than guessing", async () => {
    mockSchemas.current = { status: "loading" };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(mockRenameCalls).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("refuses when the module is not in the schema store", async () => {
    mockSchemas.current = { status: "success", data: {} };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(mockRenameCalls).toEqual([]);
  });

  test("refuses when the module is not a record", async () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: { type: "object", opt: false, items: {} } },
    };
    await rename("/blogs/why-val", "/blogs/why-val-2");
    expect(mockRenameCalls).toEqual([]);
  });
});
