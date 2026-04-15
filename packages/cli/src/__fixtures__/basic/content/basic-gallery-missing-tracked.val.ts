import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-missing-tracked.val.ts",
  s.images({
    directory: "/public/val/images4",
    accept: "image/*",
  }),
  {
    "/public/val/images4/missing.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  },
);
