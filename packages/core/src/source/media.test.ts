import { createRemoteRef } from "./remote";
import { fillFromGallery, isRemoteMediaPath, mediaUrl } from "./media";

const REMOTE_REF = createRemoteRef("https://remote.val.build", {
  publicProjectId: "p1",
  coreVersion: "1.0.0",
  bucket: "b1",
  validationHash: "vh",
  fileHash: "fh",
  filePath: "public/val/hero_a1b2c.png",
});

describe("mediaUrl", () => {
  test.each([
    {
      name: "published /public path drops the /public prefix",
      src: { path: "/public/val/hero_a1b2c.png" },
      expected: "/val/hero_a1b2c.png",
    },
    {
      name: "drafted /public path is served by the files API",
      src: { path: "/public/val/hero_a1b2c.png", patch_id: "pt1" },
      expected: "/api/val/files/public/val/hero_a1b2c.png?patch_id=pt1",
    },
    {
      name: "published remote ref is the path itself",
      src: { path: REMOTE_REF },
      expected: REMOTE_REF,
    },
    {
      name: "drafted remote ref is served locally, carrying the ref",
      src: { path: REMOTE_REF, patch_id: "pt2" },
      expected: `/api/val/files/public/val/hero_a1b2c.png?patch_id=pt2&remote=true&ref=${encodeURIComponent(
        REMOTE_REF,
      )}`,
    },
    {
      name: "absolute path outside /public is served as written",
      src: { path: "/images/hero.png" },
      expected: "/images/hero.png",
    },
    {
      // A path that is neither under /public nor a valid remote ref must still
      // produce something: this runs on every read now that there is no _type
      // to short-circuit on.
      name: "garbage path does not throw",
      src: { path: "not-a-path", patch_id: "pt3" },
      expected: "not-a-path?patch_id=pt3",
    },
  ])("$name", ({ src, expected }) => {
    expect(mediaUrl(src)).toBe(expected);
  });
});

describe("isRemoteMediaPath", () => {
  test("only /public is local", () => {
    expect(isRemoteMediaPath("/public/val/x.png")).toBe(false);
    expect(isRemoteMediaPath(REMOTE_REF)).toBe(true);
    expect(isRemoteMediaPath("/images/x.png")).toBe(true);
  });
});

describe("fillFromGallery", () => {
  const galleryEntry = { width: 8, height: 8, mimeType: "image/png" };
  const schema = {
    type: "image" as const,
    opt: false,
    referencedModule: "/content/gallery.val.ts",
  };

  test("fills width, height and mimeType from a local key", () => {
    const filled = fillFromGallery(
      { path: "/public/img/hero_a1b2c.png" },
      schema,
      () => ({ "/public/img/hero_a1b2c.png": galleryEntry }),
    );
    expect(filled).toEqual({
      path: "/public/img/hero_a1b2c.png",
      ...galleryEntry,
    });
  });

  test("finds a remote ref by the local path it was uploaded from", () => {
    const filled = fillFromGallery({ path: REMOTE_REF }, schema, () => ({
      "public/val/hero_a1b2c.png": galleryEntry,
    }));
    expect(filled).toEqual({ path: REMOTE_REF, ...galleryEntry });
  });

  test("leaves an authored alt alone", () => {
    const filled = fillFromGallery(
      { path: "/public/img/hero_a1b2c.png", alt: "An override" },
      schema,
      () => ({
        "/public/img/hero_a1b2c.png": { ...galleryEntry, alt: "The gallery's" },
      }),
    );
    expect(filled).toEqual({
      path: "/public/img/hero_a1b2c.png",
      alt: "An override",
      ...galleryEntry,
    });
  });

  test("a path the gallery does not track is returned untouched", () => {
    const src = { path: "/public/img/missing.png" };
    expect(
      fillFromGallery(src, schema, () => ({
        "/public/img/hero_a1b2c.png": galleryEntry,
      })),
    ).toEqual(src);
  });

  test("a field with no referenced module is returned untouched", () => {
    const src = { path: "/public/val/hero_a1b2c.png" };
    expect(
      fillFromGallery(src, { type: "image" as const, opt: false }, () => {
        throw new Error("must not be asked for a module");
      }),
    ).toEqual(src);
  });
});
