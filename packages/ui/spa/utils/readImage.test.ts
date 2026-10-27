/** @jest-environment jsdom */
import { readImageFromFile } from "./readImage";

/**
 * A file the browser cannot decode as an image settles the promise.
 *
 * `readDecodedImage` listened for the image's `load` and nothing else. A text
 * file, or a corrupt JPEG, fires `error` instead, so the promise never
 * settled and whatever awaited it — the image field's upload — waited for
 * ever, showing "Uploading…".
 */
describe("readImageFromFile, given a file that is not an image", () => {
  const original = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  );
  beforeEach(() => {
    // jsdom decodes no images at all; this fails the way a browser does for
    // bytes that are not a picture. On the prototype, because `Image` is a
    // legacy factory: a subclass of it is not what `new Image()` returns.
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      get: () => "",
      set(this: HTMLImageElement) {
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      },
    });
  });
  afterEach(() => {
    if (original) {
      Object.defineProperty(HTMLImageElement.prototype, "src", original);
    }
  });

  test("rejects, naming the file", async () => {
    await expect(
      readImageFromFile(
        new File(["hello"], "notes.txt", { type: "text/plain" }),
      ),
    ).rejects.toEqual({ message: "Could not read notes.txt as an image" });
  });
});
