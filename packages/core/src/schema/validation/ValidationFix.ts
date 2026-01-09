export const ValidationFix = [
  "image:add-metadata",
  "image:check-metadata",
  "image:upload-remote",
  "image:download-remote",
  "image:check-remote",
  "file:add-metadata",
  "file:check-metadata",
  "file:upload-remote",
  "file:download-remote",
  "file:check-remote",
  "keyof:check-keys",
  "router:check-route",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
