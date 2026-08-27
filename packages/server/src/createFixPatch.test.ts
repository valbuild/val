import { mediaValue } from "./createFixPatch";

/**
 * The value the four remote fixes replace a media field with.
 *
 * Each of them wrote this shape out by hand, and `image:check-remote` was left
 * behind writing `{_type, _ref, metadata}` when the shape changed — a fix that
 * would have put a marker object back into a user's file. Hence one name, and a
 * test on it.
 */
describe("mediaValue", () => {
  test("puts the metadata beside the path, not inside it", () => {
    expect(
      mediaValue("https://remote.val.build/file/p/x/hero.png", {
        width: 944,
        height: 944,
        mimeType: "image/png",
      }),
    ).toEqual({
      path: "https://remote.val.build/file/p/x/hero.png",
      width: 944,
      height: 944,
      mimeType: "image/png",
    });
  });

  test("a media value with no metadata is just a path", () => {
    expect(mediaValue("/public/val/hero.png", undefined)).toEqual({
      path: "/public/val/hero.png",
    });
  });

  test("keeps the authored fields the fix is not about", () => {
    // `alt` and `hotspot` share the object with the derived fields now, so a
    // whole-value fix must carry them across.
    expect(
      mediaValue("/public/val/hero.png", {
        width: 8,
        height: 8,
        mimeType: "image/png",
        alt: "A hero",
        hotspot: { x: 0.5, y: 0.3 },
      }),
    ).toEqual({
      path: "/public/val/hero.png",
      width: 8,
      height: 8,
      mimeType: "image/png",
      alt: "A hero",
      hotspot: { x: 0.5, y: 0.3 },
    });
  });

  test("the path the fix names wins over a stray one in the metadata", () => {
    expect(
      mediaValue("/public/val/new.png", { path: "/public/val/old.png" }),
    ).toEqual({ path: "/public/val/new.png" });
  });

  test("metadata that is not an object is ignored rather than spread", () => {
    expect(mediaValue("/public/val/hero.png", "nonsense")).toEqual({
      path: "/public/val/hero.png",
    });
    expect(mediaValue("/public/val/hero.png", [1, 2])).toEqual({
      path: "/public/val/hero.png",
    });
  });
});
