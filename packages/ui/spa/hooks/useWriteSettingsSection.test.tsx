/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";

// `mock`-prefixed so jest allows the factory below to close over them.
const mockAddPatch = jest.fn();
let mockSectionSource: { status: string; data?: unknown } = {
  status: "success",
  data: undefined,
};

jest.mock("../components/ValFieldProvider", () => ({
  __esModule: true,
  useAddPatch: () => ({ addPatch: mockAddPatch }),
  useShallowSourceAtPath: () => mockSectionSource,
}));

import { useWriteSettingsSection } from "./useWriteSettingsSection";

const FIELDS = ["available", "default"] as const;

function write(): (
  changes: Partial<Record<(typeof FIELDS)[number], JSONValue>>,
) => void {
  const { result } = renderHook(() =>
    useWriteSettingsSection(
      "/settings.val.ts" as ModuleFilePath,
      "locales",
      FIELDS,
    ),
  );
  return result.current;
}

/** The ops of the one patch that was added. */
function onePatch(): Patch {
  expect(mockAddPatch).toHaveBeenCalledTimes(1);
  return mockAddPatch.mock.calls[0][0];
}

beforeEach(() => {
  mockAddPatch.mockClear();
  mockSectionSource = { status: "success", data: undefined };
});

describe("useWriteSettingsSection", () => {
  test("an absent section is created, with its other fields explicitly unset", () => {
    // A `replace` inside a section that does not exist has nothing to replace
    // a key in, and `{}` is the normal state of a fresh settings module.
    write()({ default: "en-US" });
    expect(onePatch()).toEqual([
      {
        op: "add",
        path: ["locales"],
        value: { available: null, default: "en-US" },
      },
    ]);
  });

  test("two fields written together are ONE patch, so neither loses the other", () => {
    // The bug this hook's shape exists for. Adding the first language sets
    // `available` and `default` at once; as two calls the second would rebuild
    // the section — `hasSection` is read from the store, so it is still false
    // when the second call is made — and write `available: null` over the
    // language just added.
    write()({ available: ["nb-NO"], default: "nb-NO" });
    expect(onePatch()).toEqual([
      {
        op: "add",
        path: ["locales"],
        value: { available: ["nb-NO"], default: "nb-NO" },
      },
    ]);
  });

  test("an existing section is written key by key, so a sibling is not touched", () => {
    mockSectionSource = { status: "success", data: { available: ["nb-NO"] } };
    write()({ default: "nb-NO" });
    expect(onePatch()).toEqual([
      { op: "add", path: ["locales", "default"], value: "nb-NO" },
    ]);
  });

  test("an existing section takes several fields in one patch too", () => {
    mockSectionSource = { status: "success", data: { available: ["nb-NO"] } };
    write()({ default: null, available: ["nb-NO", "en-US"] });
    // In the declared order rather than the caller's, which is what makes the
    // patch the same however the caller happened to build the object.
    expect(onePatch()).toEqual([
      { op: "add", path: ["locales", "available"], value: ["nb-NO", "en-US"] },
      { op: "add", path: ["locales", "default"], value: null },
    ]);
  });

  test("nothing to write writes nothing", () => {
    // The panel only sends what moved, so "nothing moved" reaches here — and an
    // empty patch would still be a patch in the publish diff.
    write()({});
    expect(mockAddPatch).not.toHaveBeenCalled();
  });
});
