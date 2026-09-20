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
  },
);
