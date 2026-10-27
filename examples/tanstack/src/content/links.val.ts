import { s, c, externalPageRouter } from "../../val.config";

/**
 * `externalPageRouter`: pages that are NOT in this application.
 *
 * A router is what tells Val that a record's keys are ROUTES rather than
 * arbitrary strings, and which conventions to read them by. `tanstackRouter`
 * says "the keys are URLs this app serves, and the module is named after the
 * route file that serves them"; `externalPageRouter` says "the keys are whole
 * URLs somewhere else", so there is no route file to sit beside and the module
 * lives wherever you like.
 *
 * The Studio treats them the same way either way — a Pages tree keyed by
 * address, with the key validated as a URL rather than typed free-hand.
 *
 * A link is not only a web page: `mailto:` and `tel:` are keys here too. The
 * default policy is a deny list rather than an allow list — any scheme except
 * the handful that are not links at all (`javascript:`, `data:`, `vbscript:`,
 * `file:`, `blob:`), which an external page key must never be, because it ends
 * up in an `href` in this app's own markup. A project that wants to be
 * stricter calls the router: `externalPageRouter({ schemes: ["https"] })`.
 */
export default c.define(
  "/src/content/links.val.ts",
  s.router(
    externalPageRouter,
    s
      .object({
        title: s.string(),
        blurb: s.string().nullable(),
      })
      .preview(({ val }) => ({ title: val.title, subtitle: val.blurb })),
  ),
  {
    "https://val.build": {
      title: "Val",
      blurb: "The home page of this CMS",
    },
    "https://tanstack.com/start": {
      title: "TanStack Start",
      blurb: "The framework this example is built on",
    },
    "https://github.com/valbuild/val": {
      title: "Val on GitHub",
      blurb: null,
    },
    "mailto:hello@val.build": {
      title: "Email us",
      blurb: "A scheme with no host: grouped under val.build in the Studio",
    },
    "tel:+4712345678": {
      title: "Call us",
      blurb: "Nothing to open, so the link check reports it rather than trying",
    },
  },
);
