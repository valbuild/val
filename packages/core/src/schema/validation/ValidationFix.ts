export const ValidationFix = [
  "image:add-metadata",
  "image:check-metadata",
  "image:upload-remote",
  "image:download-remote",
  "image:check-remote",
  "images:check-remote",
  "images:upload-remote",
  "file:add-metadata",
  "file:check-metadata",
  "file:upload-remote",
  "file:download-remote",
  "file:check-remote",
  "files:check-remote",
  "files:upload-remote",
  // A video's mimeType, width, height and duration, read from its bytes. One
  // code for both "missing" and "check": unlike an image, a video is never
  // re-checked once it has them, because reading a video is not cheap enough
  // to do on every validate.
  "video:add-metadata",
  // A video that should be on Val Remote but is on disk, or the reverse. One
  // fix moves EVERY file the video names — the video (for an HLS stream, the
  // playlists and segments, with each playlist rewritten to name the others
  // where they now are), its poster and its caption tracks — because a video
  // half on each side is not one that plays.
  "video:upload-remote",
  "video:download-remote",
  // A `s.videoset()` entry without what is read from its bytes. The set's own
  // twin of `video:add-metadata`: the file is the entry's KEY, not a `path`.
  "videos:add-metadata",
  "videos:check-remote",
  "videos:upload-remote",
  "keyof:check-keys",
  "router:check-route",
  "locale:check-locale",
  "images:check-unique-folder",
  "files:check-unique-folder",
  "images:check-all-files",
  "files:check-all-files",
  "videos:check-unique-folder",
  "videos:check-all-files",
  "jsonValues:extract-entry",
  "record:fill-keys",
  // Entries written inline in a `.val.ts` whose record is `.external()`. Moves
  // them into the store — which is a write to live data, so it is applied by
  // `val external upload` and deliberately NOT by a blanket `val validate --fix`.
  "external:upload",
  // A view's stored pointer names a different module than its schema does.
  // Only reachable from hand-written JSON — in a `.val.ts` the source type is
  // the literal path, so a mismatch does not compile. The schema is the
  // authority, so there is exactly one correct value and it can be written
  // without asking anyone.
  "view:check-module",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
