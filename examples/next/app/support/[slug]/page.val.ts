import { s, c, type t, nextAppRouter } from "../../../val.config";

/**
 * Support pages use `.jsonValues()`: each page's content lives in its own
 * `*.val.json` file and is loaded lazily via `c.json(() => import(...))`.
 * This keeps `page.val.ts` tiny even with thousands of support pages.
 */
export const supportPageSchema = s.object({
  title: s.string().minLength(2),
  body: s.string(),
  order: s.number(),
});

export type SupportPage = t.inferSchema<typeof supportPageSchema>;

export default c.define(
  "/app/support/[slug]/page.val.ts",
  s
    .router(nextAppRouter, supportPageSchema)
    .jsonValues()
    // A RECORD-level custom validator on a jsonValues record: the walkthrough uses
    // it to exercise the "needs-keys" round. The validator itself only looks at the
    // KEYS (so it is meaningful even where entry content is not loaded), but the
    // client cannot know that — a record-level validator is a statement about all
    // entries, so every un-loaded entry gets loaded before it runs. That cost is
    // inherent; prefer putting validators on the ITEM schema, which needs one key.
    .validate((src) =>
      Object.keys(src ?? {}).length > 50
        ? "at most 50 support pages (keep the nav usable)"
        : false,
    ),
  {
    "/support/getting-started": c.json(
      () => import("./content/getting-started.val.json"),
    ),
    "/support/faq": c.json(() => import("./content/faq.val.json")),
  },
);
