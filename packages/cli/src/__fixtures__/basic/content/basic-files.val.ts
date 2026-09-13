import { c, s } from "../val.config";

export default c.define(
  "/content/basic-files.val.ts",
  s.fileset({
    dir: "/public/val/files",
    accept: "*/*",
  }),
  {
    "/public/val/files/tracked.txt": {
      mimeType: "text/plain",
    },
  },
);
