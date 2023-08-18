export const ValidationFix = [
  "image:add-metadata",
  "image:check-metadata",
] as const;

export type ValidationFix = (typeof ValidationFix)[number];
