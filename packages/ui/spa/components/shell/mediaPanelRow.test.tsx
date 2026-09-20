/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaPanel } from "./MediaPanel";
import { ShellMediaGallery } from "./types";

/**
 * What clicking a gallery row does.
 *
 * It used to do two things: put that gallery in the editor, replacing whatever
 * you were looking at, and expand the row. Two outcomes from one target, and the
 * louder one was the one nobody asked for — browsing the media tree cost you the
 * page you were editing. The row now only expands, and opening the gallery is a
 * control of its own.
 */
const GALLERY: ShellMediaGallery = {
  id: "images",
  name: "Images",
  dir: "/public/val/images",
  moduleFilePath: "/content/media.val.ts",
  itemCount: 1,
  mediaType: "images",
  files: [
    {
      ref: "/public/val/images/a.png",
      sourcePath: '/content/media.val.ts?p="/public/val/images/a.png"',
    },
  ],
};

/**
 * A second gallery, so the rows start closed.
 *
 * A project with exactly ONE gallery opens it on sight — see `soleGalleryId` in
 * `MediaPanel`, and the test for it at the bottom of this file. These tests are
 * about what CLICKING a row does, which needs a row that has somewhere to go,
 * so they use a project with two.
 */
const OTHER_GALLERY: ShellMediaGallery = {
  id: "documents",
  name: "Documents",
  dir: "/public/val/documents",
  moduleFilePath: "/content/documents.val.ts",
  itemCount: 0,
  mediaType: "files",
  files: [],
};

function panel(props?: {
  onSelect?: (gallery: ShellMediaGallery) => void;
  media?: ShellMediaGallery[];
}) {
  return (
    <MediaPanel
      breakpoint="desktop"
      media={props?.media ?? [GALLERY, OTHER_GALLERY]}
      selectedId={null}
      onSelect={props?.onSelect ?? (() => undefined)}
      onClose={() => undefined}
    />
  );
}

describe("a gallery row in the media panel", () => {
  test("expands, and leaves the editor where it was", () => {
    const onSelect = jest.fn();
    render(panel({ onSelect }));
    const row = screen.getByTitle("/content/media.val.ts");
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(row);

    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
    // And what expanding it is for: the files under it.
    expect(screen.getByText(/a\.png/)).not.toBeNull();
  });

  test("clicking it again collapses it", () => {
    render(panel());
    const row = screen.getByTitle("/content/media.val.ts");
    fireEvent.click(row);
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  test("opening the gallery is its own control", () => {
    const onSelect = jest.fn();
    render(panel({ onSelect }));
    fireEvent.click(screen.getByLabelText("Open Images in the editor"));
    expect(onSelect).toHaveBeenCalledWith(GALLERY);
    // Opening is not expanding: the row it belongs to stays as it was.
    expect(
      screen.getByTitle("/content/media.val.ts").getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

/**
 * The one-gallery case.
 *
 * Most projects have exactly one, and a panel called Media whose entire
 * content is a single collapsed row named after a module file is what produced
 * "what is the point of Media?". There is nothing to choose between, so it is
 * open.
 */
describe("a project with a single gallery", () => {
  test("opens it, so Media shows media", () => {
    render(panel({ media: [GALLERY] }));
    expect(
      screen.getByTitle("/content/media.val.ts").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText(/a\.png/)).not.toBeNull();
  });

  test("and closing it stays closed", () => {
    render(panel({ media: [GALLERY] }));
    const row = screen.getByTitle("/content/media.val.ts");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  // The galleries arrive after mount, so the first render of every project is
  // a project with none: deciding this from the initial value alone would
  // never fire.
  test("opens it even though the galleries arrive late", () => {
    const { rerender } = render(panel({ media: [] }));
    rerender(panel({ media: [GALLERY] }));
    expect(
      screen.getByTitle("/content/media.val.ts").getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
