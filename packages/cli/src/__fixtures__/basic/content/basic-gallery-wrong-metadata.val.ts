import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-wrong-metadata.val.ts",
  s.images({
    directory: "/public/val/images3",
    accept: "image/*",
  }),
  {
    "/public/val/images3/image.png": {
      width: 999,
      height: 999,
      mimeType: "image/png",
      alt: null,
    },
  },
);
