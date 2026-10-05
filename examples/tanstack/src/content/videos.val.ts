import { s, c } from "../../val.config";

/**
 * `s.videoset()`: a COLLECTION of videos, the video twin of `s.imageset()`
 * (`gallery.val.ts`).
 *
 * An entry holds what is true of the FILE — what it is, how big, how long —
 * and, as DEFAULTS, what a page chooses about it: the description, poster,
 * start and end, focal point and captions. A field that picks from the set
 * (`s.video(videosVal)`, see `video.val.ts`) starts from those and overrides
 * any of them key by key, so the same clip can open one page at 0:01 and
 * every other page where the set says, without being uploaded twice.
 *
 * The poster is also the gallery's thumbnail of the entry — the one picture a
 * stream has, since a tile cannot seek in one.
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
      poster: {
        path: "/public/val/videoset/intro-poster_a627f.webp",
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
      posterTime: 1,
      endTime: 3.5,
      hotspot: { x: 0.3, y: 0.6 },
      captions: [
        {
          path: "/public/val/videoset/intro-en_150f1.vtt",
          srclang: "en",
          label: "English",
        },
      ],
    },
    "/public/val/videoset/intro_05198/master.m3u8": {
      mimeType: "application/vnd.apple.mpegurl",
      width: 640,
      height: 360,
      duration: 4,
      alt: "The same test pattern, as a stream",
      poster: {
        path: "/public/val/videoset/intro-stream-poster_a627f.webp",
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
      posterTime: 1,
    },
  },
);
