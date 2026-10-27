import { s, c } from "./val.config";

/**
 * The project's settings.
 *
 * At the root of the content tree, and there can only be one — see
 * `s.settings()`. Every section is optional, so `{}` is a valid settings
 * module; this one fills in the assistant so the chat in the Studio has
 * something to go on.
 */
export default c.define("/settings.val.ts", s.settings(), {
  // Declaring these is what turns the locale feature on: the Locales tab, the
  // locale picker in the top bar, and the check behind every `s.locale()` all
  // read this list. A project that declares none sees none of it — which is
  // why this app showed nothing about locales until this line existed.
  locales: {
    available: ["en-US", "nb-NO"],
  },
  assistant: {
    // Without this the example app would OFFER the assistant and ask before
    // using it, which is the right default for a project nobody has decided
    // about — and the wrong thing for the app we develop against.
    enabled: true,
    context:
      "This is the Val example app: a Next.js site used to exercise every part of Val itself. Its content is fixtures — blogs, authors, a support section, a handbook, media galleries — so treat requests as demonstrations rather than as real editorial work.",
    tone: "Plain and direct. British English, sentence case in headings, and no exclamation marks.",
  },
});
