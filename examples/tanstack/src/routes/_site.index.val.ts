import { s, c, type t, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";
import galleryVal from "../content/gallery.val";

/*
 * The content of `src/routes/_site.index.tsx`.
 *
 * A route module is named after the route file it sits beside — the `.tsx`
 * becomes `.val.ts` — and its keys are the URLs that route serves. For the
 * index route that is just "/".
 *
 * It is also where the page-builder shapes are: an array of a discriminated
 * union, rendered inline, which is what a "blocks" editor is made of.
 */

/**
 * `s.discriminatedUnion()`: one of several object shapes, told apart by a tag.
 *
 * The first argument names the field carrying the tag; every variant sets it to
 * a distinct `s.literal(...)`. The editor shows a dropdown of the tags and the
 * fields of whichever is selected. It is a CONTAINER — a walk descends into the
 * matching variant — which is what makes it a different kind of thing from
 * `s.enum()`, a leaf whose value is just one of a fixed set of strings.
 *
 * `.render({ as: "inline" })` on the ITEM of an array or record draws the field
 * itself inside each sortable row instead of a row you click into. That is the
 * whole of what a render may say: layout, only while the field is in front of
 * you. What a string looks like when it holds more than a line is the schema's
 * own business (`.multiline()`, `s.code()`), not a layout bolted on from
 * outside.
 */
const blockSchema = s
  .discriminatedUnion(
    "type",
    s
      .object({
        type: s.literal("prose"),
        /** `s.richtext()`: every tag and style is off until the options ask. */
        body: s.richtext({
          bold: true,
          italic: true,
          lineThrough: true,
          h2: true,
          h3: true,
          ul: true,
          ol: true,
          // `a` and `img` can be given a SCHEMA instead of `true`, which is how
          // a link is constrained to routes this app actually serves.
          a: s.route(),
          img: s.image(galleryVal),
        }),
      })
      .preview(({ val }) => ({ title: "Prose", subtitle: val.type })),
    s
      .object({
        type: s.literal("callout"),
        /** `s.enum()`: a LEAF — a string with a closed domain, never encoded. */
        tone: s.enum("info", "warning", "success"),
        title: s.string().maxLength(60),
        text: s.string().multiline(),
        dismissible: s.boolean(),
      })
      .preview(({ val }) => ({ title: val.title, subtitle: val.tone })),
    s
      .object({
        type: s.literal("stat"),
        label: s.string(),
        /** `s.number()` with a range the editor enforces. */
        value: s.number().min(0).max(1_000_000),
        /** `s.datetime()`: an ISO 8601 instant, stored in UTC. */
        measuredAt: s.datetime().describe("When this number was true"),
      })
      .preview(({ val }) => ({ title: val.label, subtitle: `${val.value}` })),
    s
      .object({
        type: s.literal("snippet"),
        /**
         * `s.code()`: a string edited in a code editor.
         *
         * Its own type rather than a layout on `s.string()`, because the
         * language is part of what the content IS — and because being a type is
         * what keeps the value out of the stega encoding. Invisible characters
         * woven into source code are not something a reader can run.
         */
        source: s.code({ language: "typescript" }),
        caption: s.string().nullable(),
      })
      .preview(({ val }) => ({ title: "Snippet", subtitle: val.caption })),
  )
  .render({ as: "inline" });

export const schema = s.object({
  hero: s.object({
    title: s
      .string()
      .minLength(4)
      .maxLength(80)
      .describe("The first thing on the page"),
    image: s.image(),
    lead: s.richtext({ bold: true, italic: true, a: true }),
    /** `s.regexp()`: a format the editor checks as it is typed. */
    ctaLabel: s
      .string()
      .regexp(/^\S.*\S$/, "No leading or trailing whitespace")
      .describe("The call-to-action label"),
    /** `s.route()`, narrowed: only pages under /posts and /docs. */
    ctaHref: s
      .route()
      .exclude(/^\/val/)
      .describe("Where the call to action goes"),
  }),
  /** `s.keyOf()`: a reference to a key of another module's record. */
  author: s.keyOf(authorsVal).describe("Who wrote this page"),
  tags: s.array(s.string()),
  /** `s.date()`: a calendar date, no time and no timezone to get wrong. */
  published: s.date(),
  blocks: s.array(blockSchema).describe("The page body, block by block"),
});

export type Content = t.inferSchema<typeof schema>;

export default c.define(
  "/src/routes/_site.index.val.ts",
  /**
   * The three-argument `s.router()`: router, KEY schema, item schema.
   *
   * The key schema is what the "New page" form asks for, so its description is
   * the help text an editor reads while typing a URL — the one place a key is
   * ever entered.
   */
  s.router(
    tanstackRouter,
    s.string().describe("The URL this page is served at"),
    schema.preview(({ val }) => ({
      title: val.hero.title,
      image: val.hero.image,
    })),
  ),
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
        ctaLabel: "Read the docs",
        ctaHref: "/docs/getting-started",
      },
      author: "freekh",
      tags: ["CMS", "react", "tanstack"],
      published: "2025-01-09",
      blocks: [
        {
          type: "prose",
          body: [
            { tag: "h2", children: ["Every schema Val has"] },
            {
              tag: "p",
              children: [
                "The blocks below are one ",
                { tag: "span", styles: ["italic"], children: ["array"] },
                " of a discriminated union, rendered inline.",
              ],
            },
            {
              tag: "p",
              children: [
                {
                  tag: "img",
                  src: { path: "/public/val/gallery/brand-blue_9e87d.png" },
                },
              ],
            },
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Edit any of this in the Studio",
          text: "Open /val, change a value, and watch this page follow.",
          dismissible: true,
        },
        {
          type: "stat",
          label: "Schema types",
          value: 24,
          measuredAt: "2025-01-09T12:00:00.000Z",
        },
        {
          type: "snippet",
          source:
            "const page = useValRoute(pageVal, {});\nreturn <h1>{page.hero.title}</h1>;",
          caption: "Reading this very page",
        },
      ],
    },
  },
);
