/**
 * The assistant's fields, in the order a new section is written with. A file
 * of its own so the Settings panel and `webSearchSetting.ts` share it without
 * the latter importing React.
 */
export const ASSISTANT_FIELDS = [
  "enabled",
  "context",
  "tone",
  "webSearch",
] as const;

export type AssistantField = (typeof ASSISTANT_FIELDS)[number];
