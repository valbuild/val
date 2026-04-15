import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-2.val.ts",
  s.images({
    directory: "/public/val/images2",
    accept: "image/*",
  }),
  {
    "/public/val/images2/image.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  },
);
