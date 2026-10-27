import { c, s } from "../val.config";
import basicGalleryVal from "./basic-gallery.val";

export default c.define(
  "/content/basic-image-from-gallery.val.ts",
  s.object({
    image: s.image(basicGalleryVal),
  }),
  {
    image: { path: "/public/val/images/image.png" },
  },
);
