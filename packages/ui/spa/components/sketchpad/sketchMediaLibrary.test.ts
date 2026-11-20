import { initVal } from "@valbuild/core";
import { knownSketchMedia, sketchMediaLibraryOf } from "./sketchMediaLibrary";

const { s } = initVal();

const schemas = {
  "/content/media.val.ts": s
    .imagedir("/public/val/images", { alt: s.string().nullable() })
    ["executeSerialize"](),
  "/content/home.val.ts": s
    .object({ hero: s.object({ image: s.image() }) })
    ["executeSerialize"](),
};
const sources = {
  "/content/media.val.ts": {
    "/public/val/images/team.webp": {
      width: 10,
      height: 10,
      mimeType: "image/webp",
      alt: "The team",
    },
  },
  "/content/home.val.ts": {
    hero: { image: { path: "/public/val/hero.jpg", alt: "A roof" } },
  },
};

describe("what a box may show", () => {
  test("a gallery's images, the content's, and the chat's", () => {
    const library = sketchMediaLibraryOf({
      schemas,
      sources,
      filePatchIds: new Map([["/public/val/hero.jpg", "p1"]]),
      sessionImages: [{ key: "k1", url: "blob:x", name: "upload.png" }],
    });
    expect(library.galleries).toEqual([
      {
        name: "/public/val/images",
        items: [
          {
            src: "/public/val/images/team.webp",
            url: "/val/images/team.webp",
            type: "image",
            label: "The team",
          },
        ],
      },
    ]);
    expect(library.site).toEqual([
      {
        src: "/public/val/hero.jpg",
        url: "/api/val/files/public/val/hero.jpg?patch_id=p1",
        type: "image",
        label: "A roof",
        detail: "home › image",
      },
    ]);
    expect(library.session).toEqual([
      expect.objectContaining({ src: "session:k1", url: "blob:x" }),
    ]);
  });

  test("anything else is not the project's", () => {
    const known = knownSketchMedia(schemas, sources);
    expect(known("/public/val/hero.jpg")).toBe(true);
    expect(known("/public/val/images/team.webp")).toBe(true);
    expect(known("session:anything")).toBe(true);
    expect(known("/val/hero.jpg")).toBe(false);
    expect(known("https://example.com/cat.jpg")).toBe(false);
  });
});
