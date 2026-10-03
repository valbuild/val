import { s, c } from "../../val.config";

/**
 * `s.videoset()`: a COLLECTION of videos, the video twin of `s.imageset()`
 * (`gallery.val.ts`).
 *
 * An entry holds only what is true of the FILE: what it is, how big, how long,
 * and a description. A field that picks from the set (`s.video(videosVal)`,
 * see `video.val.ts`) carries what one page chose about the video — its own
 * poster, start and end, focal point and captions — so the same clip can open
 * one page at 0:02 and another at 0:10 without being uploaded twice.
 *
 * An HLS stream is one entry, keyed by its master playlist: the playlists and
 * segments beside it belong to it. With `stream` set, the Studio converts every
 * upload to a stream in the browser, as `s.video({ stream })` does.
 */
export default c.define(
  "/src/content/videos.val.ts",
  s.videoset({
    dir: "/public/val/videoset",
    accept: "video/*",
    stream: { type: "hls", renditions: [720, 480] },
    alt: s.string().nullable().describe("What happens in the video"),
  }),
  {
    "/public/val/videoset/intro_51df2.mp4": {
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      duration: 4,
      alt: "A colour test pattern with a moving gradient",
    },
    "/public/val/videoset/intro_05198/master.m3u8": {
      mimeType: "application/vnd.apple.mpegurl",
      width: 640,
      height: 360,
      duration: 4,
      alt: "The same test pattern, as a stream",
    },
  },
);
