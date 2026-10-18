import { s, c, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";
import imagesVal from "../content/images.val";

/** One entry per journal post, keyed by its URL. */
export default c.define(
  "/src/routes/_site.journal.$slug.val.ts",
  s.router(
    tanstackRouter,
    s.string().describe("The URL of this post. Lower case, no spaces."),
    s
      .object({
        title: s.string().minLength(4).maxLength(80),
        summary: s
          .string()
          .maxLength(200)
          .describe("One or two sentences, shown in the list of posts"),
        author: s.keyOf(authorsVal),
        publishedAt: s.date(),
        cover: s.image(imagesVal),
        body: s.richtext({
          bold: true,
          italic: true,
          h2: true,
          ul: true,
          ol: true,
          a: true,
        }),
      })
      .preview(({ val }) => ({
        title: val.title,
        subtitle: val.publishedAt,
        image: val.cover,
      })),
  ),
  {
    "/journal/a-week-at-the-roaster": {
      title: "A week at the roaster",
      summary:
        "Mondays are for roasting. What happens between the green beans arriving and the bag reaching your door.",
      author: "ingrid",
      publishedAt: "2026-09-14",
      cover: { path: "/public/val/images/roastery_29a98.jpg" },
      body: [
        {
          tag: "p",
          children: [
            "Every Monday at six, the roaster is lit. It takes forty minutes to come up to temperature, which is exactly how long the first pot of coffee lasts.",
          ],
        },
        { tag: "h2", children: ["Small batches"] },
        {
          tag: "p",
          children: [
            "We roast twelve kilos at a time. It is slower than it needs to be, and that is the point: every batch is ",
            { tag: "span", styles: ["italic"], children: ["tasted"] },
            " before it is bagged.",
          ],
        },
        {
          tag: "ul",
          children: [
            {
              tag: "li",
              children: [{ tag: "p", children: ["Monday: roast"] }],
            },
            {
              tag: "li",
              children: [{ tag: "p", children: ["Tuesday: rest and taste"] }],
            },
            {
              tag: "li",
              children: [{ tag: "p", children: ["Wednesday: post"] }],
            },
          ],
        },
      ],
    },
    "/journal/harvest-in-huila": {
      title: "Harvest in Huila",
      summary:
        "Tomas spent three weeks in Colombia this spring. He came back with a new farm and a lot of photographs.",
      author: "tomas",
      publishedAt: "2026-08-02",
      cover: { path: "/public/val/images/harvest_05126.jpg" },
      body: [
        {
          tag: "p",
          children: [
            "Huila sits high in the south of Colombia, and the coffee there ripens slowly. That is good for flavour and hard on the people picking it.",
          ],
        },
        {
          tag: "p",
          children: [
            "This year we are buying from a family farm we have visited ",
            { tag: "span", styles: ["bold"], children: ["three times"] },
            " now. Their first lot lands in October.",
          ],
        },
      ],
    },
    "/journal/the-friday-pour-over": {
      title: "The Friday pour-over",
      summary:
        "Our recipe, written down at last, for the cup we make when the week is done.",
      author: "ingrid",
      publishedAt: "2026-06-20",
      cover: { path: "/public/val/images/pour-over_12b5a.jpg" },
      body: [
        {
          tag: "ol",
          children: [
            {
              tag: "li",
              children: [
                {
                  tag: "p",
                  children: ["15 grams of coffee, ground medium-fine."],
                },
              ],
            },
            {
              tag: "li",
              children: [
                {
                  tag: "p",
                  children: ["250 grams of water, just off the boil."],
                },
              ],
            },
            {
              tag: "li",
              children: [
                {
                  tag: "p",
                  children: ["Bloom for thirty seconds, then pour slowly."],
                },
              ],
            },
          ],
        },
        {
          tag: "p",
          children: ["Done in three minutes. Drink it while it is too hot."],
        },
      ],
    },
  },
);
