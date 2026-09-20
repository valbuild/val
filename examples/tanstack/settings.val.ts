import { s, c } from "./val.config";

/**
 * The project's settings: `s.settings()`.
 *
 * One per project, and it has to sit at the ROOT of the content tree — a module
 * file path with no directory segment. Every section is optional, so `{}` is a
 * complete settings module and stays one as sections are added.
 *
 * It is what turns features on rather than a place to keep content: declaring
 * `locales.available` is what makes the Locales tab, the locale picker and every
 * `s.locale()` check exist at all. A project that declares none sees none of it.
 */
export default c.define("/settings.val.ts", s.settings(), {
  locales: {
    // Read by `src/content/translated.val.ts`, both ways round.
    available: ["en-US", "nb-NO"],
  },
  theme: {
    accent: "#3b82f6",
    radius: "soft",
    mode: "dark",
  },
  assistant: {
    // Without this the Studio OFFERS the assistant and asks first, which is the
    // right default for a project nobody has decided about — and the wrong one
    // for an app whose whole job is to show the features.
    enabled: true,
    context:
      "This is the Val TanStack Start example: a showcase app that exercises every schema type Val has. Its content is fixtures, so treat requests as demonstrations rather than as real editorial work.",
    tone: "Plain and direct. Sentence case in headings, and no exclamation marks.",
  },
});
