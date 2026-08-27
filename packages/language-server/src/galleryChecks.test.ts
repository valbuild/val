import type { SourcePath } from "@valbuild/core";
import type { ValidationError } from "@valbuild/server";
import {
  galleryCheckKey,
  isGalleryCheckFix,
  resolveGalleryChecks,
} from "./diagnostics";

const GALLERY_PATH = "/content/gallery.val.ts?p=" as SourcePath;

const uniqueFolder: ValidationError = {
  message: "Gallery directory '/public/img' must be unique across all galleries",
  value: { directory: "/public/img", type: "images" },
  fixes: ["images:check-unique-folder"],
};
const allFiles: ValidationError = {
  message: "Directory '/public/img' may have files not tracked by this gallery",
  value: { directory: "/public/img", type: "images" },
  fixes: ["images:check-all-files"],
};

describe("isGalleryCheckFix", () => {
  test("recognises the four unconditional gallery checks", () => {
    for (const fix of [
      "images:check-unique-folder",
      "files:check-unique-folder",
      "images:check-all-files",
      "files:check-all-files",
    ]) {
      expect(isGalleryCheckFix(fix)).toBe(true);
    }
  });

  test("does not claim metadata fixes", () => {
    expect(isGalleryCheckFix("image:add-metadata")).toBe(false);
  });
});

describe("galleryCheckKey", () => {
  test("distinguishes two placeholders at the same source path", () => {
    // A gallery module carries both checks at the same path, so the fix names
    // have to be part of the key or one verdict silently answers for both.
    expect(galleryCheckKey(GALLERY_PATH, uniqueFolder)).not.toBe(
      galleryCheckKey(GALLERY_PATH, allFiles),
    );
  });
});

describe("resolveGalleryChecks", () => {
  test("records null when the handler finds nothing wrong", async () => {
    const verdicts = await resolveGalleryChecks({
      validation: { [GALLERY_PATH]: [uniqueFolder, allFiles] },
      runHandler: async () => [],
    });
    expect(verdicts.get(galleryCheckKey(GALLERY_PATH, uniqueFolder))).toEqual([]);
    expect(verdicts.get(galleryCheckKey(GALLERY_PATH, allFiles))).toEqual([]);
  });

  test("records the handler's own message when it finds a problem", async () => {
    const verdicts = await resolveGalleryChecks({
      validation: { [GALLERY_PATH]: [allFiles] },
      runHandler: async () => [
        {
          sourcePath: GALLERY_PATH,
          message: "Files in '/public/img' are not tracked: a.png",
        },
      ],
    });
    expect(verdicts.get(galleryCheckKey(GALLERY_PATH, allFiles))).toEqual([
      {
        sourcePath: GALLERY_PATH,
        message: "Files in '/public/img' are not tracked: a.png",
      },
    ]);
  });

  test("keeps the placeholder when the handler throws", async () => {
    // A handler that throws tells us nothing about the gallery; claiming it is
    // fine would hide a real problem.
    const verdicts = await resolveGalleryChecks({
      validation: { [GALLERY_PATH]: [allFiles] },
      runHandler: async () => {
        throw new Error("service would not evaluate");
      },
    });
    expect(verdicts.get(galleryCheckKey(GALLERY_PATH, allFiles))).toEqual([
      {
        sourcePath: GALLERY_PATH,
        message: allFiles.message,
        fixes: allFiles.fixes,
      },
    ]);
  });

  test("ignores errors that are not gallery checks", async () => {
    const metadata: ValidationError = {
      message: "Image metadata is incorrect",
      value: {},
      fixes: ["image:check-metadata"],
    };
    let calls = 0;
    const verdicts = await resolveGalleryChecks({
      validation: { [GALLERY_PATH]: [metadata] },
      runHandler: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
    expect(verdicts.size).toBe(0);
  });
});
