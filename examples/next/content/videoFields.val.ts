import { c, s } from "../val.config";

/**
 * `s.video()` fields, for the e2e suite and the language server.
 *
 * Its own module rather than fields added to `mediaFields.val.ts`, whose shape
 * the media specs and the language server's completion tests depend on.
 *
 * - `clip` is a committed mp4 with a poster and a caption track, so "can I see
 *   what is already there" is covered by the repo.
 * - `empty` starts NULL, the case that once crashed every media field (a hook
 *   below an early return).
 * - `stream` asks for HLS. Whether the Studio can make one depends on the
 *   browser (WebCodecs with an H.264 encoder); where it cannot, the original
 *   file goes up and the field says so.
 */
export default c.define(
  "/content/videoFields.val.ts",
  s.object({
    clip: s.video({ dir: "/public/test/videos" }),
    empty: s.video({ dir: "/public/test/videos" }).nullable(),
    stream: s
      .video({ dir: "/public/test/videos", stream: { type: "hls" } })
      .nullable(),
  }),
  {
    clip: {
      path: "/public/test/videos/intro_51df2.mp4",
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      duration: 4,
      posterTime: 1,
      poster: {
        path: "/public/test/videos/intro-poster_a627f.webp",
        width: 640,
        height: 360,
        mimeType: "image/webp",
      },
      captions: [
        {
          path: "/public/test/videos/intro-en_150f1.vtt",
          srclang: "en",
          label: "English",
        },
      ],
    },
    empty: null,
    stream: null,
  },
);
