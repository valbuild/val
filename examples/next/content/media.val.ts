import { c, s } from "../val.config";

export default c.define(
  "/content/media.val.ts",
  s.images({
    accept: "image/webp",
    directory: "/public/val/images",
    alt: s.string().minLength(4),
  }),
  {
    "/public/val/images/foo.webp": {
      width: 800,
      height: 600,
      mimeType: "image/webp",
      alt: "An example image",
    },
  },
);
