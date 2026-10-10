import { s, c } from "../../val.config";

/**
 * `s.fontset()`: an `s.fileset()` for typefaces. The entry holds a mime type
 * and nothing else, exactly like `downloads.val.ts` — what is different is
 * that the Studio previews each file set in itself, in the gallery, in the
 * picker of a field that points here, and in the field once one is chosen.
 *
 * `accept` defaults to every web font format (woff2, woff, ttf, otf). This set
 * narrows it to woff2, the one format every current browser reads and the
 * smallest on the wire — the Studio does not convert fonts, so the accept is
 * where a project says which format it wants.
 *
 * Nunito Sans, under the SIL Open Font License: see `fonts.OFL.txt`.
 */
export default c.define(
  "/src/content/fonts.val.ts",
  s.fontset({ dir: "/public/val/fonts", accept: "font/woff2" }),
  {
    "/public/val/fonts/nunito-sans-regular_49fe0.woff2": {
      mimeType: "font/woff2",
    },
    "/public/val/fonts/nunito-sans-bold_6bccb.woff2": {
      mimeType: "font/woff2",
    },
  },
);
