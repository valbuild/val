import { s, c, type t } from "../val.config";
import kbVal from "./kb.val";
import supportVal from "../app/support/[slug]/page.val";
import tagsVal from "./tags.val";

/**
 * An ORDINARY module that holds references INTO the `.jsonValues()` modules.
 *
 * This is the direction that costs nothing: to find these referrers the Studio
 * scans this module's source, which is fully loaded, and it needs only the target
 * record's KEY SET — which markers already carry. So renaming or deleting a
 * referenced key finds the refs here without loading a single entry.
 *
 * Used by walkthrough steps V10 (zero requests) and V12.
 */
export const schema = s.object({
  label: s.string(),
  /** Points at a key of the big jsonValues record. */
  kbEntry: s.keyOf(kbVal),
  /** Points at a key of the jsonValues ROUTER. */
  supportPage: s.keyOf(supportVal),
  /** Points at the same router by ROUTE, which is matched by value, not schema. */
  supportRoute: s.route(),
  /** Points at an ordinary record that no jsonValues schema mentions. */
  tag: s.keyOf(tagsVal),
});

export type FeaturedContent = t.inferSchema<typeof schema>;

export default c.define("/content/featuredContent.val.ts", schema, {
  label: "Featured this week",
  kbEntry: "kb-000",
  supportPage: "/support/getting-started",
  supportRoute: "/support/getting-started",
  tag: "guides",
});
