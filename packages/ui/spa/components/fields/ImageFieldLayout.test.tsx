/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { initVal, SerializedSchema, SourcePath } from "@valbuild/core";

/**
 * How an image is drawn where there is little room, and what a drop does.
 *
 * Three things, each of which looked right in one place and wrong in another
 * before it was pinned:
 *
 * - An image as a value in an array row (`ImagePreview`) is a SQUARE cropped
 *   at the focal point, like a record row — it was the whole picture shrunk
 *   into 60×60, a different shape per image — and its URL comes from the
 *   patch while the image is a draft, or the row shows a broken picture until
 *   the editor saves.
 * - `compact` (an inline list, the canvas panel, the overlay) is the small
 *   card, not a full-width one per item.
 * - A dropped file is uploaded when it is an image and refused, with a
 *   reason, when it is not: a drop skips the file dialog's `accept` filter.
 */
const mockSchema = jest.fn();
const mockSource = jest.fn();
const mockFilePatchIds = jest.fn(() => new Map<string, string>());
const mockUploadImage = jest.fn(() => Promise.resolve(null));
const mockGalleryEntry = jest.fn<unknown, [string]>(() => ({
  status: "loading",
}));
const mockUpload = jest.fn(() => ({
  loading: false,
  progressPercentage: null as number | null,
}));

jest.mock("../ValFieldProvider", () => ({
  __esModule: true,
  useValField: () => ({
    source: mockSource(),
    schema: mockSchema(),
    addPatch: jest.fn(),
    patchPath: ["cover"],
    addAndUploadPatchWithFileOps: jest.fn(),
    addModuleFilePatch: jest.fn(),
    hasUnsavedOwnEdit: false,
  }),
  useShallowSourceAtPath: () => mockSource(),
  useValConfig: () => ({}),
  useModuleSchema: () => undefined,
  useFilePatchIds: () => mockFilePatchIds(),
  useSourceAtPath: (path: string) => mockGalleryEntry(path),
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
jest.mock("../MediaPicker/MediaPicker", () => ({
  __esModule: true,
  ModuleMediaPicker: () => null,
}));
jest.mock("../Preview", () => ({
  __esModule: true,
  PreviewLoading: () => null,
  PreviewNull: () => null,
}));
jest.mock("./useImageUpload", () => ({
  __esModule: true,
  useImageUpload: () => ({
    uploadImage: mockUploadImage,
    error: null,
    ...mockUpload(),
  }),
}));

import { ImageField, ImagePreview } from "./ImageField";

const { s, c } = initVal();
const PATH = '/content/page.val.ts?p="cover"' as SourcePath;
const IMAGE = {
  path: "/public/val/cover_a1b2c.jpg",
  width: 800,
  height: 1400,
  mimeType: "image/jpeg",
  hotspot: { x: 0.7, y: 0.25 },
};

function given(
  source: Partial<typeof IMAGE> | null,
  schema: SerializedSchema = s.image().nullable()["executeSerialize"](),
) {
  mockSchema.mockReturnValue({ status: "success", data: schema });
  mockSource.mockReturnValue({
    status: "success",
    data: source,
    clientSideOnly: false,
  });
}

/** The `<img>` the preview drew. It has no accessible name: `alt` is empty. */
function picture(container: HTMLElement): HTMLImageElement {
  const img = container.querySelector("img");
  if (!img) throw new Error("no image was drawn");
  return img;
}

beforeEach(() => {
  mockFilePatchIds.mockReturnValue(new Map());
  mockUploadImage.mockClear();
  mockGalleryEntry.mockClear();
  mockGalleryEntry.mockReturnValue({ status: "loading" });
  mockUpload.mockReturnValue({ loading: false, progressPercentage: null });
});

describe("an image as a value in an array row", () => {
  test("is a square cropped at the focal point", () => {
    given(IMAGE);
    const { container } = render(<ImagePreview path={PATH} />);
    const img = picture(container);
    expect(img.className).toContain("object-cover");
    expect(img.style.objectPosition).toBe("70% 25%");
    const box = img.parentElement;
    expect(box?.className).toContain("h-12");
    expect(box?.className).toContain("w-12");
  });

  test("is served from its patch while it is a draft", () => {
    given(IMAGE);
    mockFilePatchIds.mockReturnValue(new Map([[IMAGE.path, "patch-1"]]));
    const { container } = render(<ImagePreview path={PATH} />);
    expect(picture(container).getAttribute("src")).toContain(
      "patch_id=patch-1",
    );
  });
});

describe("the image field's card", () => {
  test("is a full-width 16:9 card by default", () => {
    given(IMAGE);
    render(<ImageField path={PATH} />);
    const view = screen.getByRole("button", { name: "View image" });
    expect(view.parentElement?.className).toContain("aspect-video");
  });

  test("is the small card when compact", () => {
    given(IMAGE);
    render(<ImageField path={PATH} compact />);
    const view = screen.getByRole("button", { name: "View image" });
    expect(view.parentElement?.className).toContain("w-40");
    expect(view.parentElement?.className).not.toContain("aspect-video");
    // The controls are beside the picture, not floated over it.
    const replace = screen.getByRole("button", { name: /Replace/ });
    expect(view.parentElement?.contains(replace)).toBe(false);
  });
});

describe("dropping a file on an empty image field", () => {
  function drop(file: File) {
    const zone = screen.getByText("Drop an image here, or").closest("div");
    if (!zone) throw new Error("no drop zone");
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } });
  }

  test("uploads an image", () => {
    given(null);
    render(<ImageField path={PATH} />);
    const file = new File(["x"], "photo.png", { type: "image/png" });
    drop(file);
    expect(mockUploadImage).toHaveBeenCalledWith(file);
  });

  test("refuses a file that is not an image, and says why", () => {
    given(null);
    render(<ImageField path={PATH} />);
    drop(new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(screen.getByText("notes.txt is not an image.")).toBeTruthy();
  });
});

describe("a gallery-backed image field", () => {
  const GALLERY = "/content/media.val.ts";
  const gallery = c.define(GALLERY, s.imageset({ dir: "/public/val" }), {});
  const schema: SerializedSchema = s
    .image(gallery)
    .nullable()
    ["executeSerialize"]();

  /**
   * Its value is `{ path, hotspot }`: the size and type are on the gallery's
   * entry. Read from the value alone, the card said nothing about the file
   * and never drew a checkerboard behind a transparent one.
   */
  test("shows the size and type from the gallery's entry", () => {
    given({ path: "/public/val/logo.png", hotspot: IMAGE.hotspot }, schema);
    mockGalleryEntry.mockReturnValue({
      status: "success",
      data: { width: 900, height: 500, mimeType: "image/png", alt: "A logo" },
    });
    const { container } = render(<ImageField path={PATH} />);
    expect(mockGalleryEntry).toHaveBeenCalledWith(
      `${GALLERY}?p="/public/val/logo.png"`,
    );
    expect(
      screen.getByText("900 × 500 · image/png · focal point 70%, 25%"),
    ).toBeTruthy();
    expect(picture(container).className).toContain("val-checkerboard");
  });

  test("does not read a gallery for a field that has none", () => {
    given(IMAGE);
    render(<ImageField path={PATH} />);
    expect(mockGalleryEntry).not.toHaveBeenCalled();
  });
});

describe("the upload progress bar", () => {
  function progressbar() {
    return screen.getByRole("progressbar", { name: "Uploading" });
  }

  test("announces no value while it has nothing to measure", () => {
    given(null);
    mockUpload.mockReturnValue({ loading: true, progressPercentage: 0 });
    render(<ImageField path={PATH} />);
    expect(progressbar().getAttribute("aria-valuenow")).toBeNull();
  });

  test("announces the percentage once bytes are moving", () => {
    given(null);
    mockUpload.mockReturnValue({ loading: true, progressPercentage: 42 });
    render(<ImageField path={PATH} />);
    expect(progressbar().getAttribute("aria-valuenow")).toBe("42");
  });
});
