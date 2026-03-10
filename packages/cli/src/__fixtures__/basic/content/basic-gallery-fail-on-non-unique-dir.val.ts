import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-fail-on-non-unique-dir.val.ts",
  s.images({
    directory: "/public/val/images",
    accept: "image/*",
  }),
  {
    "/public/val/images/image.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  },
);
