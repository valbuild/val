import { c, s } from "../val.config";

/** `s.fileset()`: the same gallery component with `imageMode` off. */
export default c.define(
  "/content/fileGallery.val.ts",
  s.fileset({
    accept: "*/*",
    dir: "/public/test/files",
  }),
  { "/public/test/files/note_7dae5.txt": { mimeType: "text/plain" } },
);
