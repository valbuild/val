import { c, s } from "../val.config";

/** `s.files()`: the same gallery component with `imageMode` off. */
export default c.define(
  "/content/fileGallery.val.ts",
  s.files({
    accept: "*/*",
    directory: "/public/test/files",
  }),
  { "/public/test/files/note_7dae5.txt": { mimeType: "text/plain" } },
);
