import { c, s } from "../val.config";

/** `s.filedir()`: the same gallery component with `imageMode` off. */
export default c.define(
  "/content/fileGallery.val.ts",
  s.filedir("/public/test/files", { accept: "*/*" }),
  { "/public/test/files/note_7dae5.txt": { mimeType: "text/plain" } },
);
