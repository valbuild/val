import { s, c } from "../../val.config";

/**
 * `s.filedir()`: the same collection as `s.imagedir()`, for files that are not
 * images — so the entry holds a mime type and nothing else, and the Studio
 * renders the gallery without the image preview.
 *
 * `accept` is the HTML file-input syntax, so a comma-separated list of exact
 * types and `type/*` wildcards both work. A file whose mime type the list does
 * not allow is a validation error, not a silently accepted upload.
 */
export default c.define(
  "/src/content/downloads.val.ts",
  s.filedir("/public/val/downloads", { accept: "application/pdf,text/plain" }),
  {
    "/public/val/downloads/handbook_c3161.pdf": {
      mimeType: "application/pdf",
    },
    "/public/val/downloads/release-notes_d9a65.txt": {
      mimeType: "text/plain",
    },
  },
);
