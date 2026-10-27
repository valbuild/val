import { Internal } from "@valbuild/core";
import { galleryKeyOf } from "./galleryKey";

const REF = Internal.remote.createRemoteRef("https://remote.val.build", {
  publicProjectId: "p",
  coreVersion: "0.1.0",
  bucket: "b",
  validationHash: "abcd",
  fileHash: "bfbd0a1b2c3d",
  filePath: "public/val/img.png",
});

describe("galleryKeyOf", () => {
  test("an exact key wins", () => {
    expect(galleryKeyOf(REF, new Set([REF, "/public/val/img.png"]))).toBe(REF);
  });
  test("falls back to the local path inside a ref only when the ref is not a key", () => {
    expect(galleryKeyOf(REF, new Set(["/public/val/img.png"]))).toBe(
      "/public/val/img.png",
    );
    expect(galleryKeyOf(REF, new Set(["public/val/img.png"]))).toBe(
      "public/val/img.png",
    );
  });
  test("a path that names no key is its own", () => {
    expect(galleryKeyOf(REF, new Set())).toBe(REF);
    expect(galleryKeyOf("/public/val/x.png", new Set())).toBe(
      "/public/val/x.png",
    );
  });
});
