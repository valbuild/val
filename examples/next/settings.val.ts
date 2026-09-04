import { s, c } from "./val.config";

/**
 * The project's settings.
 *
 * At the root of the content tree, and there can only be one — see
 * `s.settings()`. Every section is optional, so `{}` is a valid settings
 * module; this one fills in the AI section so the assistant in the Studio has
 * something to go on.
 */
export default c.define("/settings.val.ts", s.settings(), {
  ai: {
    // Would be on anyway — unset means on — but this is the file people copy
    // from, and a setting nobody can see is a setting nobody knows about.
    enabled: true,
    context:
      "This is the Val example app: a Next.js site used to exercise every part of Val itself. Its content is fixtures — blogs, authors, a support section, a handbook, media galleries — so treat requests as demonstrations rather than as real editorial work.",
    tone: "Plain and direct. British English, sentence case in headings, and no exclamation marks.",
  },
});
