import { s, c } from "../../val.config";
import galleryVal from "./gallery.val";
import downloadsVal from "./downloads.val";

/**
 * Single media FIELDS, which are the other half of the media story.
 *
 * A collection (`s.imageset()` / `s.fileset()`, see `gallery.val.ts` and
 * `downloads.val.ts`) is a library of files. A FIELD is one slot in a piece of
 * content that happens to hold a file. The rule for choosing:
 *
 * - `s.image()` / `s.file()` — the file belongs to this field and nothing else
 *   points at it. Every upload writes the bytes and the metadata together.
 * - `s.image(galleryVal)` / `s.file(filesetVal)` — the file is one of a
 *   library's. The field stores only a `path` (plus `alt` and `hotspot`); the
 *   width, height and mime type live in the gallery, keyed by that path.
 *
 * Media is a plain OBJECT with a `path`, never a constructor — the same value
 * works in a `.val.ts` and in a `*.val.json` entry. Nothing decides "this is an
 * image" by looking at the value; the schema does.
 */
export default c.define(
  "/src/content/media.val.ts",
  s.object({
    /** The plain case. Uploads land in the project's file directory. */
    hero: s.image().describe("An image that belongs to this field alone"),
    /** A field that stores its uploads somewhere of its own. */
    diagram: s
      .image({ dir: "/public/val/diagrams", accept: "image/png,image/webp" })
      .nullable()
      .describe("Its own directory, and a narrower accept"),
    /**
     * `encode`: re-encode uploads to WebP in the browser before they go up.
     *
     * Off unless asked for. It runs BEFORE the hash, which is the only correct
     * place for it — the filename, mime type, dimensions and validation hash all
     * follow from the bytes that were actually uploaded.
     */
    optimised: s
      .image({ encode: { type: "webp", maxWidth: 1200 } })
      .nullable()
      .describe("Uploads are converted to WebP and capped at 1200px"),
    /** Gallery-backed: the picker offers what the gallery already holds. */
    fromGallery: s
      .image(galleryVal)
      .nullable()
      .describe("Picked from the image collection"),
    /** The file counterpart of the plain case. */
    attachment: s
      .file({ accept: "application/pdf" })
      .nullable()
      .describe("A PDF that belongs to this field"),
    /** ...and of the gallery-backed one. */
    fromDownloads: s
      .file(downloadsVal)
      .nullable()
      .describe("Picked from the file collection"),
  }),
  {
    hero: {
      path: "/public/val/logo_7adc7.png",
      width: 944,
      height: 944,
      mimeType: "image/png",
      alt: "The Val logo",
      // A hotspot says what must stay in frame when the image is cropped.
      hotspot: { x: 0.5, y: 0.5 },
    },
    diagram: null,
    optimised: null,
    fromGallery: { path: "/public/val/gallery/ink-slate_8154a.png" },
    attachment: null,
    fromDownloads: { path: "/public/val/downloads/handbook_c3161.pdf" },
  },
);
