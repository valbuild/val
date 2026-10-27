import { s, c, tanstackRouter } from "../../val.config";

/*
 * EXPERIMENTAL: a page built from sections that know the component that
 * renders them, `.render({ as: "component" })`. In the Studio, a section shows
 * its component next to its fields - rendered by this app, through
 * `src/routes/val-preview.tsx` - and a click on its content opens that field.
 *
 * The component is a lazy `import()`: a `.val.ts` may not import app code,
 * because Val evaluates it outside of the app (`val validate`, the language
 * server, the Studio), and a thunk is never called there.
 */
export const heroSection = s
  .object({
    type: s.literal("hero"),
    title: s.string().minLength(2),
    tagline: s.string(),
    bullets: s.array(s.string()),
  })
  .render({
    as: "component",
    component: () => import("../components/sections/HeroSection"),
    // As wide as the site's content column gets
    maxWidth: 960,
    // Content that is not on the site, to stress the layout with
    example: {
      type: "hero",
      title:
        "A deliberately very long headline that should still wrap and not overflow",
      tagline:
        "A tagline that is also longer than anything an editor would realistically write.",
      bullets: [
        "A short one",
        "A considerably longer bullet point that runs onto a second line",
        "And one more, to check the spacing of a list",
      ],
    },
  });

export const quoteSection = s
  .object({
    type: s.literal("quote"),
    quote: s.string(),
    attribution: s.string(),
  })
  .render({
    as: "component",
    component: () => import("../components/sections/QuoteSection"),
    maxWidth: 560,
    // Two short fields: the component says more than they do
    defaultView: "preview",
  });

export default c.define(
  "/src/routes/_site.landing.val.ts",
  s.router(
    tanstackRouter,
    s.object({
      title: s.string(),
      sections: s.array(
        s.discriminatedUnion("type", heroSection, quoteSection),
      ),
    }),
  ),
  {
    "/landing": {
      title: "Landing",
      sections: [
        {
          type: "hero",
          title: "Ship content, not tickets",
          tagline: "Editors change sections. Developers keep the types.",
          bullets: ["Type safe", "Git backed", "No admin panel to maintain"],
        },
        {
          type: "quote",
          quote: "We stopped writing CMS glue code entirely.",
          attribution: "A very happy developer",
        },
      ],
    },
  },
);
