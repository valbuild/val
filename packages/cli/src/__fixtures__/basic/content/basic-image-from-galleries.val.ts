import { c, s } from "../val.config";
import basicGalleryVal from "./basic-gallery.val";
import basicGallery2Val from "./basic-gallery-2.val";

export default c.define(
  "/content/basic-image-from-galleries.val.ts",
  s.object({
    image1: s.image(basicGalleryVal),
    image2: s.image(basicGallery2Val),
  }),
  {
    image1: c.image("/public/val/images/image.png"),
    image2: c.image("/public/val/images2/image.png"),
  },
);
