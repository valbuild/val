import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({
    accept: "image/*",
    directory: "/public/val/images",
    alt: s.string().minLength(4),
  }),
  {
    "/public/val/images/logo.png": {
      width: 944,
      height: 944,
      mimeType: "image/png",
      alt: "An example image",
    },
  },
);
