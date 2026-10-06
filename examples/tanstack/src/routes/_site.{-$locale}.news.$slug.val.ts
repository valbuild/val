import { s, c, tanstackRouter, urlLocale } from "../../val.config";

/*
 * A route whose URL names the language it is in:
 * `src/routes/_site.{-$locale}.news.$slug.tsx` is served by this file.
 *
 * `{-$locale}` is an OPTIONAL segment, so the keys are `/news/…` (English,
 * which has no prefix) and `/nb/news/…` (Norwegian). The second argument gives
 * each route parameter a schema, by the name the route file gives it:
 *
 * - `locale` is `urlLocale` from `val.config.ts`, an enum whose `.locales()`
 *   says `nb` is `nb-NO` and a URL without the segment is `en-US`. Each page is
 *   therefore in one language, checked against `locales.available` in
 *   `/settings.val.ts` — so `/sv/news/…` is an error, and so would be adding
 *   `sv-SE` here before the settings declare it.
 * - `slug` is an ordinary string, with the rules a slug has.
 *
 * Because the URL says which language a page is in, the page itself cannot say
 * so again: an `s.locale()` field in the item would be a second answer, and is
 * a schema error.
 */
export default c.define(
  "/src/routes/_site.{-$locale}.news.$slug.val.ts",
  s.router(
    tanstackRouter,
    {
      locale: urlLocale,
      slug: s
        .string()
        .regexp(/^[a-z0-9-]+$/)
        .describe("Lower case letters, digits and hyphens"),
    },
    s
      .object({
        title: s.string(),
        body: s.richtext({ bold: true, italic: true }),
      })
      .preview(({ val }) => ({ title: val.title })),
  ),
  {
    "/news/val-in-english": {
      title: "Val, in English",
      body: [
        {
          tag: "p",
          children: [
            "This page has no language in its URL, so it is in English: that is what ",
            { tag: "span", styles: ["bold"], children: ["{ null: 'en-US' }"] },
            " says.",
          ],
        },
      ],
    },
    "/nb/news/val-pa-norsk": {
      title: "Val, på norsk",
      body: [
        {
          tag: "p",
          children: [
            "Denne siden har ",
            { tag: "span", styles: ["bold"], children: ["/nb"] },
            " i adressen, så den er på norsk.",
          ],
        },
      ],
    },
  },
);
