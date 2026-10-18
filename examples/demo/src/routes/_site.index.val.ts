import { s, c, tanstackRouter } from "../../val.config";
import imagesVal from "../content/images.val";

/** The home page. Its one key is the URL it is served at: "/". */
export default c.define(
  "/src/routes/_site.index.val.ts",
  s.router(
    tanstackRouter,
    s.string().describe("The URL this page is served at"),
    s
      .object({
        hero: s.object({
          title: s
            .string()
            .minLength(4)
            .maxLength(60)
            .describe("The first thing on the page. Keep it short."),
          lead: s.richtext({ bold: true, italic: true }),
          image: s.image(imagesVal),
          ctaLabel: s.string().maxLength(30),
          ctaHref: s.route().describe("Where the button goes"),
        }),
        features: s
          .array(
            s
              .object({
                title: s.string().maxLength(40),
                text: s.string().multiline().maxLength(240),
              })
              .preview(({ val }) => ({ title: val.title })),
          )
          .validate((features) =>
            features.length > 4
              ? "Four at most: the row has room for four"
              : false,
          )
          .describe("Up to four short selling points"),
        quote: s.object({
          text: s.string().multiline(),
          by: s.string(),
        }),
        journalHeading: s.string(),
      })
      .preview(({ val }) => ({
        title: val.hero.title,
        image: val.hero.image,
      })),
  ),
  {
    "/": {
      hero: {
        title: "Coffee, roasted this week",
        lead: [
          {
            tag: "p",
            children: [
              "We buy green coffee from farms we know, roast it in small batches every Monday, and post it to you by ",
              { tag: "span", styles: ["bold"], children: ["Wednesday"] },
              ".",
            ],
          },
        ],
        image: { path: "/public/val/images/hero-morning_f0bcf.jpg" },
        ctaLabel: "Read the journal",
        ctaHref: "/journal",
      },
      features: [
        {
          title: "Single origin",
          text: "Every bag comes from one farm, and the label says which. No blends to hide behind.",
        },
        {
          title: "Roasted weekly",
          text: "Small batches, roasted on Mondays. Your coffee is never more than a few days out of the roaster.",
        },
        {
          title: "Paid fairly",
          text: "We publish what we paid for every lot, so you can see where the money goes.",
        },
      ],
      quote: {
        text: "The best cup of coffee I have had at home. I did not know a filter could taste like this.",
        by: "A very happy customer",
      },
      journalHeading: "From the journal",
    },
  },
);
