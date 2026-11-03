import { s, c } from "../../val.config";
import filesVal from "./files.val";
import imagesVal from "./images.val";
import postsVal from "./posts.val";
import videosVal from "./videos.val";

/**
 * A page whose fields pick from the three libraries and point at one post:
 * the picker, the gallery-backed fields and the `keyOf` dropdown at size.
 * See `posts.val.ts`.
 */
export default c.define(
  "/content/scale/featured.val.ts",
  s.object({
    title: s.string(),
    post: s.keyOf(postsVal),
    hero: s.image(imagesVal),
    download: s.file(filesVal),
    clip: s.video(videosVal),
  }),
  {
    title: "Featured",
    post: "post-0",
    hero: { path: "/public/val/scale/images/image-0.png" },
    download: { path: "/public/val/scale/files/file-0.pdf" },
    clip: { path: "/public/val/scale/videos/video-0.mp4" },
  },
);
