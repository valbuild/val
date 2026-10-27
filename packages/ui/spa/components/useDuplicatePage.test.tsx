/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { ModuleFilePath } from "@valbuild/core";
import { useDuplicatePage } from "./useDuplicatePage";

/**
 * The schema lookup in front of a page duplicate.
 *
 * `jsonValues` is not a hint here: a `.jsonValues()` record holds an opaque
 * marker for every entry that has not been loaded, and a `copy` copies what is
 * there. Get it wrong and the patch duplicates the marker instead of the page,
 * and the navigate that follows opens a `/json?key=<newKey>` the base source
 * has no entry for. So an unresolved schema store has to refuse rather than
 * fall back to `false` - which is what this used to do, inline in `ValShell`.
 */
const mockSchemas = {
  current: { status: "success", data: {} } as {
    status: string;
    data?: Record<string, unknown>;
  },
};
jest.mock("./ValFieldProvider", () => ({
  __esModule: true,
  useSchemas: () => mockSchemas.current,
}));

const mockDuplicate = jest.fn(() => Promise.resolve());
jest.mock("./useDuplicateRecordEntry", () => ({
  __esModule: true,
  useDuplicateRecordEntry: () => mockDuplicate,
}));

const router = "/app/blogs/[blog]/page.val.ts" as ModuleFilePath;

function duplicatePage() {
  return renderHook(() => useDuplicatePage()).result.current;
}

describe("useDuplicatePage", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    mockDuplicate.mockClear();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  test("copies the entry, and says the record loads on demand when it does", () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: { type: "record", jsonValues: true } },
    };
    duplicatePage()(router, "/blogs/why-val", "/blogs/why-val-copy");
    expect(mockDuplicate).toHaveBeenCalledWith({
      parentPath: router,
      fromKey: "/blogs/why-val",
      toKey: "/blogs/why-val-copy",
      jsonValues: true,
    });
  });

  test("a record that holds its entries inline is not loaded first", () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: { type: "record" } },
    };
    duplicatePage()(router, "/blogs/why-val", "/blogs/why-val-copy");
    expect(mockDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ jsonValues: false }),
    );
  });

  test("refuses while the schemas are still loading, rather than guessing", () => {
    mockSchemas.current = { status: "loading" };
    duplicatePage()(router, "/blogs/why-val", "/blogs/why-val-copy");
    expect(mockDuplicate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("refuses when the module is not in the schema store", () => {
    mockSchemas.current = { status: "success", data: {} };
    duplicatePage()(router, "/blogs/why-val", "/blogs/why-val-copy");
    expect(mockDuplicate).not.toHaveBeenCalled();
  });

  test("refuses when the module is not a record", () => {
    mockSchemas.current = {
      status: "success",
      data: { [router]: { type: "object" } },
    };
    duplicatePage()(router, "/blogs/why-val", "/blogs/why-val-copy");
    expect(mockDuplicate).not.toHaveBeenCalled();
  });
});
