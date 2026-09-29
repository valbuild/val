/** @jest-environment jsdom */
import { act, renderHook } from "@testing-library/react";

/**
 * `accept` is enforced on what will be stored, before anything is uploaded.
 *
 * The file dialog's `accept` attribute used to be the only thing enforcing it,
 * and dropping a file onto the field skips the dialog. Validation does not
 * catch a mismatch afterwards — it is `image:check-metadata`, which is treated
 * as server-repairable — so without this a field that accepts only WebP stored
 * a dropped PNG. The check is on the type AFTER re-encoding: a field that
 * converts PNG to WebP must still take a PNG.
 */
const mockReadImage = jest.fn();
jest.mock("../../utils/readImage", () => ({
  __esModule: true,
  readImageFromFile: (...args: unknown[]) => mockReadImage(...args),
}));
const mockCreateFilePatch = jest.fn();
jest.mock("./FileField", () => ({
  __esModule: true,
  createFilePatch: (...args: unknown[]) => mockCreateFilePatch(...args),
}));

import { useImageUpload } from "./useImageUpload";

const upload = jest.fn(() => Promise.resolve());

function setup(accept: string | undefined) {
  return renderHook(() =>
    useImageUpload({
      patchPath: ["cover"],
      addAndUploadPatchWithFileOps: upload,
      addModuleFilePatch: jest.fn(),
      remoteData: null,
      dir: undefined,
      referencedModule: undefined,
      encode: { settings: null, accept },
    }),
  );
}

function read(mimeType: string) {
  mockReadImage.mockResolvedValue({
    src: `data:${mimeType};base64,AAAA`,
    filename: "photo",
    fileHash: "abc",
    width: 10,
    height: 10,
    mimeType,
  });
}

beforeEach(() => {
  upload.mockClear();
  mockCreateFilePatch.mockReset();
  mockCreateFilePatch.mockResolvedValue({
    patch: [{ op: "replace", path: ["cover"], value: { path: "/p.webp" } }],
    filePath: "/p.webp",
  });
});

test("refuses a stored type the field does not accept, before uploading", async () => {
  read("image/png");
  const { result } = setup("image/webp");
  let returned: unknown;
  await act(async () => {
    returned = await result.current.uploadImage(
      new File(["x"], "photo.png", { type: "image/png" }),
    );
  });
  expect(returned).toBeNull();
  expect(mockCreateFilePatch).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(result.current.error).toBe(
    "photo.png is image/png, and this field only accepts image/webp.",
  );
  expect(result.current.loading).toBe(false);
});

test("checks the type after re-encoding, not the source's", async () => {
  // The source is a PNG; what `readImageFromFile` hands back — and what is
  // stored — is the WebP it was converted to.
  read("image/webp");
  const { result } = setup("image/webp");
  await act(async () => {
    await result.current.uploadImage(
      new File(["x"], "photo.png", { type: "image/png" }),
    );
  });
  expect(result.current.error).toBeNull();
  expect(upload).toHaveBeenCalled();
});

test("anything goes when the field does not say", async () => {
  read("image/png");
  const { result } = setup(undefined);
  await act(async () => {
    await result.current.uploadImage(
      new File(["x"], "photo.png", { type: "image/png" }),
    );
  });
  expect(result.current.error).toBeNull();
  expect(upload).toHaveBeenCalled();
});

test("a wildcard accepts any image", async () => {
  read("image/png");
  const { result } = setup("image/*");
  await act(async () => {
    await result.current.uploadImage(
      new File(["x"], "photo.png", { type: "image/png" }),
    );
  });
  expect(result.current.error).toBeNull();
  expect(upload).toHaveBeenCalled();
});
