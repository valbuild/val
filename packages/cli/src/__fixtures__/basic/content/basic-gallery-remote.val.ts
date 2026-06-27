import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-remote.val.ts",
  s.images({
    directory: "/public/val/images-remote",
    accept: "image/*",
    remote: true,
  }),

  {
    "/public/val/images-remote/image.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  },
);
