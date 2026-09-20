import { ImageSource, Internal } from "@valbuild/core";
import { mediaUrlOf } from "./mediaUrl";

/** A real ref, built the way the studio builds one — see `source/remote.ts`. */
const REMOTE_REF = Internal.remote.createRemoteRef("https://remote.val.build", {
  publicProjectId: "proj",
  coreVersion: "1",
  validationHash: "abcdef",
  fileHash: "123456",
  filePath: "public/val/hero.png",
  bucket: "bucket",
});

const NONE: ReadonlyMap<string, string> = new Map();
const PENDING: ReadonlyMap<string, string> = new Map([
  ["/public/val/photo_a1b2c.jpg", "patch_1"],
  [REMOTE_REF, "patch_2"],
]);

/**
 * The lookup that was missing wherever a preview drew a thumbnail: a file that
 * has been uploaded but not published lives in a PATCH, and the media value
 * does not say which one.
 */
describe("mediaUrlOf", () => {
  test("a published local file is served from /public, stripped", () => {
    expect(mediaUrlOf({ path: "/public/val/photo_a1b2c.jpg" }, NONE)).toBe(
      "/val/photo_a1b2c.jpg",
    );
  });

  test("an unpublished local file is served from its patch", () => {
    expect(mediaUrlOf({ path: "/public/val/photo_a1b2c.jpg" }, PENDING)).toBe(
      "/api/val/files/public/val/photo_a1b2c.jpg?patch_id=patch_1",
    );
  });

  test("a gallery hands back a bare path, and that is enough", () => {
    expect(mediaUrlOf("/public/val/photo_a1b2c.jpg", PENDING)).toBe(
      "/api/val/files/public/val/photo_a1b2c.jpg?patch_id=patch_1",
    );
  });

  test("a published remote ref is its own URL", () => {
    expect(mediaUrlOf({ path: REMOTE_REF }, NONE)).toBe(REMOTE_REF);
  });

  test("an unpublished remote ref goes through the files endpoint", () => {
    const url = mediaUrlOf({ path: REMOTE_REF }, PENDING);
    expect(url).toBe(
      "/api/val/files/public/val/hero.png?patch_id=patch_2&remote=true&ref=" +
        encodeURIComponent(REMOTE_REF),
    );
  });

  test("nothing in, nothing out — including an empty path", () => {
    expect(mediaUrlOf(null, PENDING)).toBe(null);
    expect(mediaUrlOf(undefined, PENDING)).toBe(null);
    expect(mediaUrlOf("", PENDING)).toBe(null);
    expect(mediaUrlOf({ path: "" }, PENDING)).toBe(null);
  });

  test("a whole ImageSource works — only the path decides", () => {
    const image: ImageSource = {
      path: "/public/val/photo_a1b2c.jpg",
      width: 10,
      height: 10,
      mimeType: "image/jpeg",
      alt: "x",
    };
    expect(mediaUrlOf(image, PENDING)).toBe(
      "/api/val/files/public/val/photo_a1b2c.jpg?patch_id=patch_1",
    );
  });
});
