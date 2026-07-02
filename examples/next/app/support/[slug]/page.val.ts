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
  s.router(nextAppRouter, supportPageSchema).jsonValues(),
  {
    "/support/getting-started": c.json(
      () => import("./content/getting-started.val.json"),
    ),
    "/support/faq": c.json(() => import("./content/faq.val.json")),
  },
);
