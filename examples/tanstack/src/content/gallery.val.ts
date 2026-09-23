import { s, c } from "../../val.config";

/**
 * `s.imageset()`: a COLLECTION of images, keyed by the path the bytes live at.
 *
 * The difference from `s.image()` is who owns the metadata. Here the width,
 * height and mime type are the collection's — one entry per file — so a field
 * that points at this gallery (`s.image(galleryVal)`, see `media.val.ts`)
 * carries only a `path`, and the same image used in ten places is described
 * once.
 *
 * `dir` is required on purpose: it decides where every upload into this
 * collection lands, and a default would mean a gallery that had simply not said
 * where it wanted its files silently shared a directory with every other one.
 *
 * `alt` is a SCHEMA rather than a flag, so a project can require it
 * (`s.string()`), leave it optional (the default `s.string().nullable()`) or
 * key it by language (`s.record(s.locale(), s.string())`).
 */
export default c.define(
  "/src/content/gallery.val.ts",
  s.imageset({
    accept: "image/*",
    dir: "/public/val/gallery",
    alt: s.string().minLength(3).describe("What the image shows"),
  }),
  {
    "/public/val/gallery/brand-blue_9e87d.png": {
      width: 320,
      height: 180,
      mimeType: "image/png",
      alt: "A flat blue swatch",
    },
    "/public/val/gallery/accent-amber_37f8b.png": {
      width: 320,
      height: 180,
      mimeType: "image/png",
      alt: "A flat amber swatch",
    },
    "/public/val/gallery/ink-slate_8154a.png": {
      width: 320,
      height: 180,
      mimeType: "image/png",
      alt: "A flat slate swatch",
    },
  },
);
