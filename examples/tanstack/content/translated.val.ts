import { s, c } from "../val.config";

/**
 * The two ways content says what language it is in.
 *
 * Both open a LOCALE SCOPE — a subtree governed by one language — and they are
 * the only two things that do. Which one to reach for is the question this
 * module exists to answer, so it holds one of each:
 *
 * - **A locale-keyed record** (`announcements`) when the same thing exists once
 *   per language and you want them side by side. The key IS the language, so
 *   the record holds every declared one; a language nobody has written yet is
 *   `null`, not an absent key, which is what keeps half-translated content
 *   *valid* while still being a gap you can count and filter.
 * - **A `locale` field** (`posts`) when each item is written in one language and
 *   the set of items is not per-language — a post exists in Norwegian and there
 *   is no English one waiting to be written.
 *
 * A scope may not contain another scope, so neither of these can hold the
 * other. That is a schema error, not a content one: it is reported once against
 * the schema rather than against every entry.
 *
 * With `locales.available` declared in `/settings.val.ts`, the Studio's locale
 * picker filters both — the record by its keys, the array by each row's own
 * `locale`. Content in no language at all (every other module in this app) is
 * always shown, so the filter narrows this module rather than emptying the
 * Studio.
 */
export const announcementSchema = s.object({
  title: s.string(),
  body: s.richtext({ bold: true }),
});

export const postSchema = s.object({
  /**
   * The field that opens the scope. Named `locale` here for readability only —
   * it is the SCHEMA (`s.locale()`) that opens a scope, not the key's name.
   */
  locale: s.locale(),
  title: s.string(),
  body: s.richtext({ bold: true }),
});

export default c.define(
  "/content/translated.val.ts",
  s.object({
    announcements: s.record(s.locale(), announcementSchema),
    posts: s.array(postSchema),
  }),
  {
    announcements: {
      "en-US": {
        title: "We ship on Fridays",
        body: [
          { tag: "p", children: ["Every Friday, and never on a Friday."] },
        ],
      },
      // Declared and not yet written. This is the state the whole design is
      // for: it validates, it is visible as a gap, and it is not an absent key.
      "nb-NO": null,
    },
    posts: [
      {
        locale: "nb-NO",
        title: "Vinterjakka er her",
        body: [{ tag: "p", children: ["Den kom tidlig i år."] }],
      },
      {
        locale: "en-US",
        title: "A note on sizing",
        body: [{ tag: "p", children: ["Runs small. Take one size up."] }],
      },
    ],
  },
);
