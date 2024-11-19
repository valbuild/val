export const ValidationFix = [
  "image:change-extension",
  "image:add-metadata",
  "image:check-metadata",
  "file:change-extension",
  "file:add-metadata",
  "file:check-metadata",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
