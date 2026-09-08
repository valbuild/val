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
      tags: ["CMS", "react", "tanstack"],
    },
  },
);
