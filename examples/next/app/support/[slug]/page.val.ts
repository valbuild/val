import { s, c, type t, nextAppRouter } from "../../../val.config";

/**
 * Support pages use `.jsonValues()`: each page's content lives in its own
 * `*.val.json` file and is loaded lazily via `c.json(() => import(...), sha)`.
 * This keeps `page.val.ts` tiny even with thousands of support pages.
 *
 * NOTE: the trailing sha is the validation-cache key (`<schemaHash>-<contentHash>`).
 * These are placeholders for now — Val tooling (commit flow) will generate and
 * maintain them; they are not checked on the runtime read path.
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
      "v1",
    ),
    "/support/faq": c.json(() => import("./content/faq.val.json"), "v1"),
  },
);
