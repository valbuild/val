import { s, c } from "../../val.config";

/**
 * Every video on the site. With `stream` set, a video uploaded in the Studio
 * is converted to an HLS stream in the browser before it goes anywhere -- in
 * the demo, to the server running in the same tab, which then streams it to
 * the page in the canvas.
 */
export default c.define(
  "/src/content/videos.val.ts",
  s.videodir("/public/val/videos", {
    accept: "video/*",
    stream: { type: "hls", renditions: [720, 480] },
    alt: s.string().nullable().describe("What happens in the video"),
  }),
  {
    "/public/val/videos/roastery-light_f27ba/master.m3u8": {
      mimeType: "application/vnd.apple.mpegurl",
      width: 1280,
      height: 720,
      duration: 8,
      alt: "Warm light drifting, like the roastery at dawn",
      poster: {
        path: "/public/val/videos/roastery-light-poster_31e4e.webp",
        width: 1280,
        height: 720,
        mimeType: "image/webp",
      },
      posterTime: 3,
    },
  },
);
