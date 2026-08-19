import { s } from "../val.config";

// A shared schema fragment: a snapshot that omits this file cannot be evaluated.
export const summarySchema = s.object({
  services: s.array(s.string()),
});
