import { s, c, type t } from "../val.config";

/**
 * An ordinary record that NO `.jsonValues()` item schema references.
 *
 * That is the whole point of it: deleting or renaming one of its keys is the case
 * where the reference guard must answer instantly, having loaded nothing (the load
 * predicate names no modules). Walkthrough step V12.
 */
export const schema = s.record(
  s.object({
    label: s.string().minLength(2),
  }),
);

export type Tag = t.inferSchema<typeof schema>;

export default c.define("/content/tags.val.ts", schema, {
  // Referenced from /content/featuredContent.val.ts — deleting it must be blocked.
  guides: { label: "Guides" },
  // Referenced by nothing — deleting it must be allowed, instantly.
  changelog: { label: "Changelog" },
});
