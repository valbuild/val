export const ValidationFix = [
  "image:add-metadata",
  "image:replace-metadata",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
