/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MediaThumbnail, hotspotOf } from "./MediaThumbnail";

/**
 * A thumbnail that loses the race with its own upload.
 *
 * A just-uploaded file is served from its patch, and there is a window in which
 * the URL is on screen and the server answers `404` for it — the same path works
 * a moment later. A browser neither retries a failed image nor re-requests one
 * whose `src` is unchanged, so the tile used to stay blank for as long as the
 * view was open: the upload had succeeded, the bytes were on the server, and the
 * editor was looking at a broken picture.
 */
const URL_A = "/api/val/files/public/val/a.png?patch_id=p1";

function image(): HTMLImageElement {
  const node = screen.getByRole("presentation", { hidden: true });
  if (!(node instanceof HTMLImageElement)) {
    throw new Error("the thumbnail did not render an image");
  }
  return node;
}

/** Fail the current load and let the backoff elapse. */
function failLoad(): void {
  fireEvent.error(image());
  act(() => {
    jest.advanceTimersByTime(5000);
  });
}

describe("a thumbnail whose image fails to load", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("re-requests it, with a URL the browser treats as new", () => {
    render(<MediaThumbnail url={URL_A} />);
    expect(image().getAttribute("src")).toBe(URL_A);

    failLoad();

    const retried = image().getAttribute("src");
    expect(retried).not.toBe(URL_A);
    // The original query survives: the file endpoint reads `patch_id`.
    expect(retried).toContain("patch_id=p1");
  });

  test("gives up, and only then says so", () => {
    const onError = jest.fn();
    render(<MediaThumbnail url={URL_A} onError={onError} />);

    // Three retries, and the caller hears nothing while they are happening — a
    // placeholder is the wrong answer for a file that is 400ms early.
    for (let i = 0; i < 3; i++) {
      failLoad();
      expect(onError).not.toHaveBeenCalled();
    }
    failLoad();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test("a different file starts its own count", () => {
    const onError = jest.fn();
    const { rerender } = render(
      <MediaThumbnail url={URL_A} onError={onError} />,
    );
    for (let i = 0; i < 3; i++) failLoad();

    rerender(<MediaThumbnail url="/val/b.png" onError={onError} />);
    expect(image().getAttribute("src")).toBe("/val/b.png");
    // Not "already out of retries" — the count belonged to the previous file.
    failLoad();
    expect(onError).not.toHaveBeenCalled();
    expect(image().getAttribute("src")).toContain("val_retry=1");
  });
});

/**
 * Whether the tile crops or shows the image at its own size is asked again
 * when the TILE changes size, not only when the image loads: the image card is
 * as wide as its panel, and a decision made at load time outlived the width it
 * was made for.
 */
describe("a thumbnail whose tile is resized after its image loaded", () => {
  let resize: () => void = () => {};
  const original = globalThis.ResizeObserver;
  beforeEach(() => {
    globalThis.ResizeObserver = class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterEach(() => {
    globalThis.ResizeObserver = original;
  });

  function sizeTile(tile: HTMLElement, width: number, height: number) {
    Object.defineProperty(tile, "clientWidth", {
      configurable: true,
      value: width,
    });
    Object.defineProperty(tile, "clientHeight", {
      configurable: true,
      value: height,
    });
  }

  test("switches between its own size and the crop as the tile changes", () => {
    render(<MediaThumbnail url={URL_A} />);
    const img = image();
    const tile = img.parentElement;
    if (!tile) throw new Error("no tile");
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    Object.defineProperty(img, "naturalHeight", { value: 100 });

    // Loaded in a tile bigger than the picture: covering would enlarge it.
    sizeTile(tile, 400, 200);
    fireEvent.load(img);
    expect(img.className).not.toContain("object-cover");

    // The tile narrows below the picture's size: now it can be cropped.
    sizeTile(tile, 80, 45);
    act(() => resize());
    expect(img.className).toContain("object-cover");
  });
});

describe("hotspotOf", () => {
  test("reads a well-formed focal point from gallery metadata", () => {
    expect(hotspotOf({ hotspot: { x: 0.2, y: 0.7 } })).toEqual({
      x: 0.2,
      y: 0.7,
    });
  });
  test("ignores one that is missing or malformed", () => {
    expect(hotspotOf({})).toBeUndefined();
    expect(hotspotOf(undefined)).toBeUndefined();
    expect(hotspotOf({ hotspot: { x: "0.2", y: 0.7 } })).toBeUndefined();
    expect(hotspotOf({ hotspot: null })).toBeUndefined();
  });
});
