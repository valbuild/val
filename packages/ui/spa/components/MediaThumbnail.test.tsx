/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MediaThumbnail } from "./MediaThumbnail";

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
