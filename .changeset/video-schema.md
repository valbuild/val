---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/server": minor
"@valbuild/ui": minor
"@valbuild/react": minor
"@valbuild/next": minor
"@valbuild/tanstack": minor
"@valbuild/cli": minor
"@valbuild/language-server": minor
---

New: `s.video()`, for mp4/WebM files and HLS streams.

```ts
const schema = s.object({
  intro: s.video({ stream: { type: "hls" } }),
});
```

- **Upload and play in the Studio.** A video field shows a player, the file's size and length, and progress while it uploads.
- **HLS streaming without a video service.** With `stream: { type: "hls" }`, the Studio converts an upload to an HLS stream in the editor's browser before it uploads it. It makes one H.264 rendition per height (1080p, 720p and 480p by default, and never larger than the upload) and stores them as a folder of files next to your other uploads. Nothing is installed in your app for this: the converter ships inside the Studio and is only downloaded when someone uploads to a streaming field. A browser that can't convert (no WebCodecs, or a non-https address) uploads the original file and says so.
- **Poster:** pause on a frame and choose "Use current frame". The frame is saved as an image, and `posterTime` records where it was taken.
- **Start and end:** play part of a video without cutting the file.
- **Focal point:** marks what must stay in frame when the page crops the video.
- **Description:** text for people who can't see the video.
- **Captions:** one WebVTT file per language. `.srt` files are converted on upload.
- **`<ValVideo>`** in `@valbuild/next` and `@valbuild/tanstack` renders all of the above and is click-to-edit. For HLS in browsers that can't play it natively, pass `hls={() => import("hls.js")}`. It is only loaded when it's needed.
- **Rename** a video in the Studio. An HLS stream is renamed as a whole: every playlist and segment moves to the new folder.
- `npx val validate --fix` fills in `mimeType`, `width`, `height` and `duration` for a hand-written `.mp4`, `.mov`, `.webm`, `.mkv` or HLS video.
- `.remote()` works for videos. `npx val validate --fix` moves a video to Val Remote, or back into the project, together with its poster, captions and every file of an HLS stream.

A video value always has a `mimeType`: it is how a page knows whether it has an `.mp4` or an `.m3u8`.

New: `s.videoset()`, a collection of videos, like `s.imageset()` for images.

```ts
const videosVal = c.define(
  "/content/videos.val.ts",
  s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } }),
  {},
);
const schema = s.object({ intro: s.video(videosVal) });
```

- **Upload once, use anywhere.** A set's entry holds what is true of the file: its type, size, length and a description. A field that picks from the set (`s.video(videosVal)`) keeps its own poster, start and end, focal point and captions, so the same clip can open one page at 0:02 and another at 0:10.
- **Media in the Studio.** A set is listed under Media and opens as a gallery of videos. You can upload into it (with `stream`, uploads become HLS streams), edit each video's description, rename a video, and delete a video that nothing uses. Renaming a video updates every field that uses it. An HLS stream is one entry, and renaming or deleting it moves or removes all of its files.
- **Picking.** A set-backed field picks from the set, or uploads into it.
- `useVal` and `fetchVal` fill in the set's `mimeType`, `width`, `height` and `duration`, so `<ValVideo>` works the same either way.
- `.remote()` works for sets. `npx val validate --fix` fills in missing metadata for an entry, adds untracked videos found in the set's directory, and moves a set's videos to Val Remote.
