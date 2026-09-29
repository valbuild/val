/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  initVal,
  Internal,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";

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
  error: null as string | null,
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

type TestImage = {
  path: string;
  width?: number;
  height?: number;
  mimeType?: string;
  alt?: string;
  hotspot?: { x: number; y: number };
};

function given(
  source: TestImage | null,
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
  mockUpload.mockReturnValue({
    loading: false,
    progressPercentage: null,
    error: null,
  });
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

  /**
   * A remote upload puts the remote ref in the field and files the gallery's
   * metadata under the LOCAL path inside that ref, so the exact key misses.
   * `fillFromGallery` in core looks under both; so does the card.
   */
  test("finds a remote ref's entry under the local path it came from", () => {
    const ref = Internal.remote.createRemoteRef("https://remote.val.build", {
      publicProjectId: "p",
      coreVersion: "1.0.0",
      validationHash: "v",
      fileHash: "f",
      filePath: "public/val/hero_a1b2c.png",
      bucket: "b",
    });
    given({ path: ref }, schema);
    mockGalleryEntry.mockImplementation((path: string) =>
      path === `${GALLERY}?p="public/val/hero_a1b2c.png"`
        ? {
            status: "success",
            data: { width: 640, height: 360, mimeType: "image/webp" },
          }
        : { status: "not-found" },
    );
    render(<ImageField path={PATH} />);
    expect(screen.getByText("640 × 360 · image/webp")).toBeTruthy();
  });

  /**
   * The field hides its own Description input when a gallery owns the text,
   * so the gallery's `alt` is what the image is drawn with — unless the value
   * carries one of its own, which wins, as in `fillFromGallery`.
   */
  test("is drawn with the gallery's alt, unless it has its own", () => {
    mockGalleryEntry.mockReturnValue({
      status: "success",
      data: { width: 900, height: 500, mimeType: "image/png", alt: "A logo" },
    });
    given({ path: "/public/val/logo.png" }, schema);
    const first = render(<ImageField path={PATH} />);
    expect(picture(first.container).getAttribute("alt")).toBe("A logo");
    first.unmount();

    given({ path: "/public/val/logo.png", alt: "Our logo" }, schema);
    const second = render(<ImageField path={PATH} />);
    expect(picture(second.container).getAttribute("alt")).toBe("Our logo");
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
    mockUpload.mockReturnValue({
      loading: true,
      progressPercentage: 0,
      error: null,
    });
    render(<ImageField path={PATH} />);
    expect(progressbar().getAttribute("aria-valuenow")).toBeNull();
  });

  test("announces the percentage once bytes are moving", () => {
    given(null);
    mockUpload.mockReturnValue({
      loading: true,
      progressPercentage: 42,
      error: null,
    });
    render(<ImageField path={PATH} />);
    expect(progressbar().getAttribute("aria-valuenow")).toBe("42");
  });
});

describe("while an upload is in flight", () => {
  /**
   * The upload writes its whole-image `replace` only once the bytes are up,
   * so a focal point set in between is written first and then overwritten.
   * Remove was already held back for this; the focal point is too.
   */
  test("the focal point cannot be moved or switched", () => {
    given(IMAGE);
    mockUpload.mockReturnValue({
      loading: true,
      progressPercentage: 10,
      error: null,
    });
    render(<ImageField path={PATH} />);
    fireEvent.click(screen.getByRole("button", { name: /^Focal point/ }));
    expect(
      screen
        .getByRole("button", { name: /Point to keep in frame/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("checkbox").hasAttribute("disabled") ||
        screen.getByRole("checkbox").getAttribute("data-disabled") !== null,
    ).toBe(true);
  });
});

describe("dropping onto a filled card", () => {
  test("accepts the drop on the file's name as well as on the picture", () => {
    given(IMAGE);
    render(<ImageField path={PATH} />);
    const name = screen.getByText("cover_a1b2c.jpg");
    const file = new File(["x"], "photo.png", { type: "image/png" });
    fireEvent.drop(name, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(mockUploadImage).toHaveBeenCalledWith(file);
  });

  test("announces a refused drop", () => {
    given(IMAGE);
    render(<ImageField path={PATH} />);
    fireEvent.drop(screen.getByText("cover_a1b2c.jpg"), {
      dataTransfer: {
        files: [new File(["x"], "notes.txt", { type: "text/plain" })],
        types: ["Files"],
      },
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "notes.txt is not an image.",
    );
  });
});

describe("choosing a file in the dialog", () => {
  /**
   * The dialog's "All files" lets anything through, as a drop does, and a
   * text file handed to the image decoder used to leave the field saying
   * "Uploading…" for good. It goes through the same check as a drop.
   */
  test("refuses a file that is not an image, and says why", () => {
    given(null);
    const { container } = render(<ImageField path={PATH} />);
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error("no file input");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
    });
    expect(mockUploadImage).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "notes.txt is not an image.",
    );
  });
});

/**
 * A card that will not take a file still cancels the drop. Left to the
 * browser, a dropped file is OPENED, which navigates the Studio away and
 * loses the session — and a read-only field, or one mid-upload, is exactly
 * where someone drags a file expecting it to go somewhere.
 */
test("a card that cannot take a drop still keeps the browser from opening it", () => {
  given(IMAGE);
  render(<ImageField path={PATH} readonly />);
  const notCancelled = fireEvent.drop(screen.getByText("cover_a1b2c.jpg"), {
    dataTransfer: {
      files: [new File(["x"], "photo.png", { type: "image/png" })],
      types: ["Files"],
    },
  });
  expect(notCancelled).toBe(false);
  expect(mockUploadImage).not.toHaveBeenCalled();
});

/**
 * An upload refused for its type, or for not being readable, is refused a
 * moment after the drop or the pick, with nothing taking focus: an alert, or
 * it is never heard.
 */
test("announces an upload that was refused", () => {
  given(IMAGE);
  mockUpload.mockReturnValue({
    loading: false,
    progressPercentage: null,
    error: "photo.png is image/png, and this field only accepts image/webp.",
  });
  render(<ImageField path={PATH} />);
  expect(screen.getByRole("alert").textContent).toBe(
    "photo.png is image/png, and this field only accepts image/webp.",
  );
});

/**
 * A browser reports an empty type for a format it does not recognise (HEIC on
 * some systems), which is not the same as "not an image". It goes on to the
 * decoder, which says whether it can read it.
 */
test("hands a file with no reported type on to be read", () => {
  given(null);
  render(<ImageField path={PATH} />);
  const zone = screen.getByText("Drop an image here, or").closest("div");
  if (!zone) throw new Error("no drop zone");
  const file = new File(["x"], "photo.heic", { type: "" });
  fireEvent.drop(zone, { dataTransfer: { files: [file], types: ["Files"] } });
  expect(mockUploadImage).toHaveBeenCalledWith(file);
});

/**
 * The upload writes its whole-image `replace` only once the bytes are up,
 * carrying the alt text it started with — so a second file chosen, or a
 * description typed, in the meantime would be written and then overwritten.
 */
test("replacing the file and the description wait for an upload in flight", () => {
  given(IMAGE);
  mockUpload.mockReturnValue({
    loading: true,
    progressPercentage: 10,
    error: null,
  });
  render(<ImageField path={PATH} />);
  expect(
    screen.getByRole("button", { name: /Replace/ }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
});
