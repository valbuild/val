import { s, c, type t, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";

/*
 * The content of `src/routes/_site.index.tsx`.
 *
 * A route module is named after the route file it sits beside — the `.tsx`
 * becomes `.val.ts` — and its keys are the URLs that route serves. For the
 * index route that is just "/".
 */
export const schema = s.object({
  hero: s.object({
    title: s.string().minLength(4),
    image: s.image(),
    lead: s.richtext({ bold: true, italic: true, a: true }),
  }),
  author: s.keyOf(authorsVal),
  /**
   * A pointer at the authors module, rather than a copy of it.
   *
   * `s.keyOf` above picks ONE author; the editor who wants to fix a name has to
   * go and find `/src/content/authors.val.ts` for themselves. This puts a row on
   * this page's screen that leads straight there — and, because the page now
   * declares which module it shows, the route component reads the list through
   * `useVal(page.authors)` instead of importing the module a second time.
   */
  authors: s.view(authorsVal),
  tags: s.array(s.string()),
});

export type Content = t.inferSchema<typeof schema>;

export default c.define(
  "/src/routes/_site.index.val.ts",
  s.router(tanstackRouter, schema),
  {
    "/": {
      hero: {
        title: "Content as code",
        image: {
          path: "/public/val/logo_7adc7.png",
          width: 944,
          height: 944,
          mimeType: "image/png",
          alt: "Val logo",
        },
        lead: [
          {
            tag: "p",
            children: [
              "This page is served by ",
              { tag: "span", styles: ["bold"], children: ["Val"] },
              " from a file next to the route that renders it.",
            ],
          },
        ],
      },
      author: "freekh",
      authors: { view: "/src/content/authors.val.ts" },
      tags: ["CMS", "react", "tanstack"],
    },
  },
);
