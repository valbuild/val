import { s, c } from "../../val.config";

/**
 * `s.locale()`: the two ways content says what language it is in.
 *
 * Both open a LOCALE SCOPE — a subtree governed by one language — and they are
 * the only two things that do. Which to reach for is the question this module
 * exists to answer, so it holds one of each:
 *
 * - **A locale-keyed record** (`announcements`) when the same thing exists once
 *   per language and you want them side by side. The key IS the language, so
 *   the record holds every declared one; a language nobody has written yet is
 *   `null` rather than an absent key, which keeps half-translated content valid
 *   while still being a gap you can see and count.
 * - **A `locale` field** (`posts`) when each item is written in one language and
 *   the set of items is not per-language.
 *
 * A scope may not contain another, so neither of these can hold the other.
 *
 * The languages themselves are declared once, in `/settings.val.ts` under
 * `locales.available`. Without that list there is nothing for `s.locale()` to
 * check against and no locale picker in the Studio.
 */
export const announcementSchema = s.object({
  title: s.string(),
  body: s.richtext({ bold: true }),
});

export const postSchema = s
  .object({
    /**
     * The field that opens the scope. Named `locale` for readability only — it
     * is the SCHEMA (`s.locale()`) that opens a scope, not the key's name.
     */
    locale: s.locale(),
    title: s.string(),
    body: s.richtext({ bold: true }),
  })
  .preview(({ val }) => ({ title: val.title, subtitle: val.locale }));

export default c.define(
  "/src/content/translated.val.ts",
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
      // Declared and not yet written. This is the state the design is for: it
      // validates, it is visible as a gap, and it is not an absent key.
      "nb-NO": null,
    },
    posts: [
      {
        locale: "nb-NO",
        title: "Innhold som kode",
        body: [{ tag: "p", children: ["Skrevet på norsk, og bare på norsk."] }],
      },
      {
        locale: "en-US",
        title: "Content as code",
        body: [{ tag: "p", children: ["Written in English, and only in it."] }],
      },
    ],
  },
);
