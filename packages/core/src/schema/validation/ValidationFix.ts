export const ValidationFix = [
  "image:add-metadata",
  "image:replace-metadata",
  "file:add-metadata",
  "file:check-metadata",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
