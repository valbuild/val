import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-remote.val.ts",
  s
    .imageset({
      directory: "/public/val/images-remote",
      accept: "image/*",
    })
    .remote(),

  {
    "/public/val/images-remote/image.png": {
      width: 1,
      height: 1,
      mimeType: "image/png",
      alt: null,
    },
  },
);
