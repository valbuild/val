import { c, s } from "../val.config";

export default c.define(
  "/content/basic-gallery-remote-existing.val.ts",
  s.images({
    directory: "/public/val/images-remote2",
    accept: "image/*",
    remote: true,
  }),

  {
    "https://remote.val.build/file/p/proj123/b/01/v/1.0.0/h/abc1/f/def4/p/public/val/images-remote2/image.png":
      {
        width: 1,
        height: 1,
        mimeType: "image/png",
        alt: null,
      },
  },
);
