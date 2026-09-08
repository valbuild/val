import { c, s } from "../val.config";

export default c.define(
  "/content/basic-files.val.ts",
  s.fileset({
    directory: "/public/val/files",
    accept: "*/*",
  }),
  {
    "/public/val/files/tracked.txt": {
      mimeType: "text/plain",
    },
  },
);
