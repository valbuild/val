export const ValidationFix = [
  "image:add-metadata",
  "image:replace-metadata", // TODO: rename to image:check-metadata
  "file:add-metadata",
  "file:check-metadata",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
