export const ValidationFix = [
  "image:add-metadata",
  "image:replace-metadata", // TODO: rename to image:check-metadata
  "file:add-metadata",
  "file:check-metadata",
  "fix:deprecated-richtext", // This is a fix for the c.richtext markdown-ish source that we had before. Once the c.richtext is removed, this fix can be removed.
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
