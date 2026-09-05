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
  "keyof:check-keys",
  "router:check-route",
  "images:check-unique-folder",
  "files:check-unique-folder",
  "images:check-all-files",
  "files:check-all-files",
  "jsonValues:extract-entry",
  // Entries written inline in a `.val.ts` whose record is `.external()`. Moves
  // them into the store — which is a write to live data, so it is applied by
  // `val external upload` and deliberately NOT by a blanket `val validate --fix`.
  "external:upload",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
