import { s, c } from "../val.config";

/**
 * EXPERIMENTAL: page sections that know the component that renders them.
 *
 * `.component(() => import(...))` links a section to its component: the Val
 * Studio shows it, rendered by this app, next to the section's fields, and
 * `ValComponentEditor` renders the section with it. The component is a lazy
 * `import()`: a `.val.ts` may not import app code, because Val evaluates it
 * outside of the app, and a thunk is never called there.
 *
 * The fields are declared first and linked in a second `const`: a component
 * that types its props from its section reads them from the fields, because
 * the linked schema's type depends on the component's.
 */
export const heroFields = s.object({
  type: s.literal("hero"),
  title: s.string().minLength(2),
  tagline: s.string(),
  bullets: s.array(s.string()),
  cta: s.object({
    label: s.string(),
    href: s.string(),
  }),
});
export const heroSection = heroFields.component(
  () => import("../app/sections/HeroSection"),
  {
    // A full-width section: wider than this, the site centres it.
    maxWidth: 1200,
    // Deliberately not representative of any real page: long values and a
    // long list are what make layout problems obvious.
    example: {
      type: "hero",
      title:
        "A deliberately very long headline that should still wrap and not overflow",
      tagline:
        "A tagline that is also longer than anything an editor would realistically write, so that the layout gets stress tested.",
      bullets: [
        "A short one",
        "A considerably longer bullet point that runs onto a second line",
        "Another",
        "And another",
        "And one more, to check the spacing of a long list",
      ],
      cta: {
        label: "A call to action with a long label",
        href: "https://val.build",
      },
    },
  },
);

/** No example: the preview shows the content being edited, and nothing else. */
export const quoteFields = s.object({
  type: s.literal("quote"),
  quote: s.string(),
  attribution: s.string(),
});
export const quoteSection = quoteFields.component(
  () => import("../app/sections/QuoteSection"),
  {
    // Shown in a narrow column on the site, so previewed as one.
    maxWidth: 560,
    // Two short fields: the component says more than they do.
    defaultView: "preview",
  },
);

export const schema = s.record(
  s.object({
    title: s.string(),
    sections: s.array(s.discriminatedUnion("type", heroSection, quoteSection)),
  }),
);

export default c.define("/content/pages.val.ts", schema, {
  landing: {
    title: "Landing",
    sections: [
      {
        type: "hero",
        title: "Ship content, not tickets",
        tagline: "Editors change sections. Developers keep the types.",
        bullets: ["Type safe", "Git backed", "No admin panel to maintain"],
        cta: { label: "Read the docs", href: "https://val.build/docs" },
      },
      {
        type: "quote",
        quote: "We stopped writing CMS glue code entirely.",
        attribution: "A very happy developer",
      },
    ],
  },
  pricing: {
    title: "Pricing",
    sections: [
      {
        type: "hero",
        title: "Simple pricing",
        tagline: "Pay for seats, not for API calls.",
        bullets: ["Free while you build", "Per editor after that"],
        cta: { label: "See plans", href: "https://val.build/pricing" },
      },
    ],
  },
});
