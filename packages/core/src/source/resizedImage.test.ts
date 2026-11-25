import {
  isResizableImageUrl,
  RESIZE_WIDTHS,
  resizedImageUrl,
  resizeQuality,
  resizeWidth,
} from "./resizedImage";
import { mediaUrl } from "./media";

const REF =
  "https://remote.val.build/file/p/3f9a2c1/b/bucket/v/0.136.2/h/9c41e0b2d7aa/f/3fa9c81be402/p/public/val/hero_3fa9c.jpg";
const PLATFORM_REF =
  "https://www.acme.no/_val/file/p/3f9a2c1/b/r2/v/0.136.2/h/9c41e0b2d7aa/f/3fa9c81be402/p/public/val/hero_3fa9c.png";

describe("which images are resized", () => {
  test("a published remote ref on either host", () => {
    expect(isResizableImageUrl(REF)).toBe(true);
    expect(isResizableImageUrl(PLATFORM_REF)).toBe(true);
  });

  test("the formats a host can resize, whatever the case of the extension", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "avif", "JPG"]) {
      expect(isResizableImageUrl(REF.replace(/jpg$/, ext))).toBe(true);
    }
    for (const ext of ["svg", "gif", "pdf"]) {
      expect(isResizableImageUrl(REF.replace(/jpg$/, ext))).toBe(false);
    }
  });

  test("not a local file, nor a draft, whose bytes are at neither host", () => {
    expect(isResizableImageUrl("/val/hero.jpg")).toBe(false);
    const draft = mediaUrl({ path: REF, patch_id: "patch" });
    expect(draft.startsWith("/api/val/files/")).toBe(true);
    expect(isResizableImageUrl(draft)).toBe(false);
    expect(resizedImageUrl(draft, { width: 640 })).toBeNull();
  });
});

describe("the URL of a resized image", () => {
  test("names a width on the ladder", () => {
    expect(resizedImageUrl(REF, { width: 640 })).toBe(`${REF}?w=640`);
    expect(resizedImageUrl(REF, { width: 641 })).toBe(`${REF}?w=750`);
    expect(resizedImageUrl(REF, { width: 9000 })).toBe(`${REF}?w=3840`);
  });

  test("names a quality only when it is not the default", () => {
    expect(resizedImageUrl(REF, { width: 640, quality: 80 })).toBe(
      `${REF}?w=640`,
    );
    expect(resizedImageUrl(REF, { width: 640, quality: 74 })).toBe(
      `${REF}?w=640&q=75`,
    );
  });

  test("snaps widths up and qualities to the nearest", () => {
    expect(resizeWidth(1)).toBe(RESIZE_WIDTHS[0]);
    expect(resizeWidth(1080)).toBe(1080);
    expect(resizeQuality(0)).toBe(25);
    expect(resizeQuality(60)).toBe(50);
    expect(resizeQuality(99)).toBe(100);
  });
});
