/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { initVal, SerializedSchema, SourcePath } from "@valbuild/core";

/**
 * Emptying a nullable media field from the field itself.
 *
 * The `Field` wrapper's tick box is not enough: it is only drawn for a field
 * INSIDE an object. An image opened on its own — an array item, a record
 * entry, a module whose root is the image — has no wrapper and so no tick box,
 * and before this there was nothing else that wrote `null`. A gallery-backed
 * field could be pointed at a different entry and never at none.
 *
 * The control is offered on exactly one condition — the schema says the value
 * may be `null` — so the two halves of that are what this pins.
 */
const mockAddPatch = jest.fn();
const mockSchema = jest.fn();
const mockSource = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useValField: () => ({
    source: mockSource(),
    schema: mockSchema(),
    addPatch: mockAddPatch,
    patchPath: ["cover"],
    addAndUploadPatchWithFileOps: jest.fn(),
    addModuleFilePatch: jest.fn(),
    hasUnsavedOwnEdit: false,
  }),
  useShallowSourceAtPath: () => mockSource(),
  useValConfig: () => ({}),
  useModuleSchema: () => undefined,
  useFilePatchIds: () => new Map<string, string>(),
}));
jest.mock("../ValRemoteProvider", () => ({
  __esModule: true,
  useRemoteFiles: () => ({ status: "inactive", reason: "unknown" }),
  useCurrentRemoteFileBucket: () => undefined,
}));
jest.mock("../ValPortalProvider", () => ({
  __esModule: true,
  useValPortal: () => null,
}));
// The gallery picker is a panel of its own and reaches for the store; whether
// it is offered is not what this file is about.
jest.mock("../MediaPicker/MediaPicker", () => ({
  __esModule: true,
  ModuleMediaPicker: () => null,
}));
// Only the empty/loading states of this field use it, and importing it pulls in
// the whole field tree and `ValProvider`.
jest.mock("../Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));
jest.mock("./useImageUpload", () => ({
  __esModule: true,
  useImageUpload: () => ({
    uploadImage: jest.fn(),
    loading: false,
    error: null,
    progressPercentage: null,
  }),
}));

import { ImageField } from "./ImageField";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="cover"' as SourcePath;
const IMAGE = {
  path: "/public/val/cover_a1b2c.jpg",
  width: 100,
  height: 50,
  mimeType: "image/jpeg",
};

function mount(
  schema: SerializedSchema,
  source: typeof IMAGE | null,
  readonly = false,
) {
  mockSchema.mockReturnValue({ status: "success", data: schema });
  mockSource.mockReturnValue({
    status: "success",
    data: source,
    clientSideOnly: false,
  });
  return render(<ImageField path={PATH} readonly={readonly} />);
}

describe("Remove, on a media field", () => {
  beforeEach(() => {
    mockAddPatch.mockReset();
  });

  test("writes null for a nullable image that has a file", () => {
    mount(s.image().nullable()["executeSerialize"](), IMAGE);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(mockAddPatch).toHaveBeenCalledWith(
      [{ op: "replace", path: ["cover"], value: null }],
      "image",
    );
  });

  test("is not offered when the schema does not allow null", () => {
    mount(s.image()["executeSerialize"](), IMAGE);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("is not offered when there is nothing to remove", () => {
    mount(s.image().nullable()["executeSerialize"](), null);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  test("is not offered on a readonly field", () => {
    mount(s.image().nullable()["executeSerialize"](), IMAGE, true);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});
