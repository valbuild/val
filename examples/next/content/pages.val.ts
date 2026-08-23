import { s, c } from "../val.config";
import { schema as heroSchema } from "../app/sections/hero.val";
import { schema as quoteSchema } from "../app/sections/quote.val";

/**
 * Pages built out of sections.
 *
 * The section schemas are imported, so each array item's schema *is* the schema
 * of the corresponding component module - which is how the Val UI can list
 * every place a section is used and preview it with that page's content.
 */
export const schema = s.record(
  s.object({
    title: s.string(),
    sections: s.array(s.union("type", heroSchema, quoteSchema)),
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
