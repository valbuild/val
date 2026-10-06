/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { render } from "@testing-library/react";
import { initVal, SerializedSchema, SourcePath } from "@valbuild/core";

/**
 * A remote media field does not take a file until it can build a remote ref.
 *
 * Building the ref needs two things: `/remote/settings` to have answered
 * (`remoteFiles.status === "ready"`) and a bucket to have been picked from it
 * (`useCurrentRemoteFileBucket`). The bucket is picked by an EFFECT, so there
 * is a render where the first is true and the second is not. A field that
 * enabled its input on the first alone built no remote data in that render,
 * and `createFilePatch` then made a LOCAL ref for a remote field: the file went
 * up as local and the value pointed at the repo.
 *
 * Here because the e2e suite cannot hold that render open: by the time a
 * browser test reaches the input, the effect has run. These mount each field
 * in exactly that state, and then with a bucket, and read the file input.
 */
const mockBucket = jest.fn<string | null, []>(() => null);
const mockSchema = jest.fn();
const mockSource = jest.fn();

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useValField: () => ({
    source: mockSource(),
    schema: mockSchema(),
    addPatch: jest.fn(),
    patchPath: ["media"],
    addAndUploadPatchWithFileOps: jest.fn(),
    addModuleFilePatch: jest.fn(),
    hasUnsavedOwnEdit: false,
  }),
  useShallowSourceAtPath: () => mockSource(),
  useSourceAtPath: () => mockSource(),
  useValConfig: () => ({ remoteHost: "https://remote.val.build" }),
  useModuleSchema: () => undefined,
  useFilePatchIds: () => new Map<string, string>(),
}));
jest.mock("../ValRemoteProvider", () => ({
  __esModule: true,
  useRemoteFiles: () => ({
    status: "ready",
    publicProjectId: "pid",
    coreVersion: "0.0.0",
    buckets: ["bucket-1"],
  }),
  useCurrentRemoteFileBucket: () => mockBucket(),
}));
jest.mock("../ValPortalProvider", () => ({
  __esModule: true,
  useValPortal: () => null,
}));
jest.mock("../MediaPicker/MediaPicker", () => ({
  __esModule: true,
  ModuleMediaPicker: () => null,
}));
jest.mock("../Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));

import { ImageField } from "./ImageField";
import { FileField } from "./FileField";
import { VideoField } from "./VideoField";

const { s } = initVal();
const PATH = '/content/page.val.ts?p="media"' as SourcePath;

function fileInput(
  Field: typeof ImageField,
  schema: SerializedSchema,
  bucket: string | null,
): HTMLInputElement {
  mockBucket.mockReturnValue(bucket);
  mockSchema.mockReturnValue({ status: "success", data: schema });
  mockSource.mockReturnValue({
    status: "success",
    data: null,
    clientSideOnly: false,
  });
  const { container } = render(<Field path={PATH} />);
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("the field rendered no file input");
  }
  return input;
}

const fields: [string, typeof ImageField, () => SerializedSchema][] = [
  [
    "image",
    ImageField,
    () => s.image().remote().nullable()["executeSerialize"](),
  ],
  ["file", FileField, () => s.file().remote().nullable()["executeSerialize"]()],
  [
    "video",
    VideoField,
    () => s.video().remote().nullable()["executeSerialize"](),
  ],
];

describe.each(fields)("a remote %s field", (_name, Field, schema) => {
  test("is disabled while remote settings are ready and no bucket is picked", () => {
    expect(fileInput(Field, schema(), null).disabled).toBe(true);
  });

  test("is enabled once a bucket is picked", () => {
    expect(fileInput(Field, schema(), "bucket-1").disabled).toBe(false);
  });
});
