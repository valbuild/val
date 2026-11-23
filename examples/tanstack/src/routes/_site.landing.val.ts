import { s, c, tanstackRouter } from "../../val.config";

/*
 * EXPERIMENTAL: a page built from sections that know the component that
 * renders them, `.component(() => import(...))`.
 *
 * The page renders them with `ValComponentEditor` (`_site.landing.tsx`): each
 * section is rendered by the component its own schema names, so there is no
 * `type` to component map to keep. In the Studio a section shows its
 * component next to its fields - rendered by this app, through
 * `src/routes/val-preview.tsx` - and on the page itself the sections can be
 * dragged into another order, added to and removed.
 *
 * The component is a lazy `import()`: a `.val.ts` may not import app code,
 * because Val evaluates it outside of the app (`val validate`, the language
 * server, the Studio), and a thunk is never called there.
 *
 * The fields of a section are declared FIRST, and linked to the component in
 * a second `const`. A component that types its props from its section
 * (`t.inferSchema<typeof heroFields>`) must read them from the fields: the
 * linked schema's type depends on the component's, so reading it back from
 * there is a circle TypeScript will not resolve.
 */
export const heroFields = s.object({
  type: s.literal("hero"),
  title: s.string().minLength(2),
  tagline: s.string(),
  bullets: s.array(s.string()),
});
export const heroSection = heroFields
  .describe("A headline, a tagline and a few points")
  .component(() => import("../components/sections/HeroSection"), {
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

export const quoteFields = s.object({
  type: s.literal("quote"),
  quote: s.string(),
  attribution: s.string(),
});
export const quoteSection = quoteFields
  .describe("Something someone said, and who said it")
  .component(() => import("../components/sections/QuoteSection"));

/*
 * A component that was not written for Val. `Callout` has props of its own
 * (`heading`, `body`, `tone`) and knows nothing of this schema, so `props`
 * says how to make them from the fields - and is type checked against them.
 * A string passed on as it is (`title`, `text`) can still be clicked to edit.
 */
export const noteSection = s
  .object({
    type: s.literal("note"),
    title: s.string(),
    text: s.string(),
    important: s.boolean(),
  })
  .describe("A boxed note, with a design-system component behind it")
  .component(() => import("../components/Callout"), {
    props: (note) => ({
      heading: note.title,
      body: note.text,
      tone: note.important ? "warning" : "info",
    }),
  });

/*
 * Components inside a component. A card is linked to a component too, so the
 * columns section hands its `cards` to a `ValComponentEditor` of its own
 * (`ColumnsSection.tsx`), and the cards can be arranged on the page like the
 * sections around them. They run across, which the editor works out.
 */
export const cardFields = s.object({
  title: s.string(),
  text: s.string(),
});
export const card = cardFields.component(
  () => import("../components/sections/Card"),
);
export const columnsFields = s.object({
  type: s.literal("columns"),
  heading: s.string(),
  cards: s.array(card),
});
export const columnsSection = columnsFields
  .describe("A heading over a row of cards")
  .component(() => import("../components/sections/ColumnsSection"));

/* One object, not a list: the page's closing call to action. */
export const callToActionFields = s.object({
  text: s.string(),
  label: s.string(),
  href: s.route(),
});
export const callToAction = callToActionFields.component(
  () => import("../components/sections/CallToAction"),
);

export default c.define(
  "/src/routes/_site.landing.val.ts",
  s.router(
    tanstackRouter,
    s.object({
      title: s.string(),
      sections: s.array(
        s.discriminatedUnion(
          "type",
          heroSection,
          quoteSection,
          noteSection,
          columnsSection,
        ),
      ),
      callToAction,
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
          type: "columns",
          heading: "What a section is",
          cards: [
            {
              title: "A schema",
              text: "The fields an editor fills in, typed.",
            },
            {
              title: "A component",
              text: "Yours, linked with a lazy import.",
            },
            {
              title: "Content",
              text: "In git, next to the code that renders it.",
            },
          ],
        },
        {
          type: "quote",
          quote: "We stopped writing CMS glue code entirely.",
          attribution: "A very happy developer",
        },
        {
          type: "note",
          title: "Experimental",
          text: "Components are new. Drag these sections around in the Studio.",
          important: false,
        },
      ],
      callToAction: {
        text: "Every schema type has a page in this showcase.",
        label: "See them all",
        href: "/",
      },
    },
  },
);
