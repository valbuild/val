import { s, c } from "../../val.config";

/**
 * `s.video()`: a progressive file, or an HLS stream the Studio makes.
 *
 * A video is a media object like an image — a `path` plus fields — with one
 * difference: `mimeType` is required, because a page has to know whether it
 * holds an `.mp4` or an `.m3u8` before it can play it.
 *
 * - `width`, `height`, `duration` and `mimeType` are read from the file. The
 *   Studio writes them on upload; `npx val validate --fix` fills them in for
 *   a hand-written mp4.
 * - `posterTime` and `poster`: the frame the still before playback was taken
 *   from, and that still as an image. "Use current frame" in the Studio.
 * - `startTime` / `endTime`: play part of the file without cutting it.
 * - `hotspot`: what stays in frame when the page crops the video.
 * - `alt`: what happens in the video, for people who cannot see it.
 * - `captions`: one WebVTT file per language (`.srt` is converted on upload).
 *
 * `ValVideo` renders all of it; see `_site.showcase.tsx`.
 */
export default c.define(
  "/src/content/video.val.ts",
  s.object({
    /** The plain case: whatever was uploaded is what is stored. */
    clip: s
      .video({ dir: "/public/val/videos", accept: "video/mp4,video/webm" })
      .describe("An mp4 or WebM, uploaded as it is"),
    /**
     * `stream`: the Studio converts an upload to HLS in the browser
     * (WebCodecs), one H.264 rendition per height that fits the upload, and
     * stores the stream as a directory. `path` is its master playlist.
     */
    stream: s
      .video({
        dir: "/public/val/videos",
        stream: { type: "hls", renditions: [720, 480] },
      })
      .nullable()
      .describe("Uploads are converted to an HLS stream in the browser"),
  }),
  {
    clip: {
      path: "/public/val/videos/intro_51df2.mp4",
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      duration: 4,
      alt: "A colour test pattern with a moving gradient",
      posterTime: 1,
      poster: {
        path: "/public/val/videos/intro-poster_a627f.webp",
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
      startTime: 0.5,
      hotspot: { x: 0.5, y: 0.5 },
      captions: [
        {
          path: "/public/val/videos/intro-en_150f1.vtt",
          srclang: "en",
          label: "English",
          default: true,
        },
      ],
    },
    stream: {
      path: "/public/val/videos/intro_05198/master.m3u8",
      mimeType: "application/vnd.apple.mpegurl",
      width: 640,
      height: 360,
      duration: 4,
      alt: "The same test pattern, as a stream",
      posterTime: 1,
      poster: {
        path: "/public/val/videos/intro-poster_a627f.webp",
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
    },
  },
);
