import { s, c, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";
import imagesVal from "../content/images.val";

/** The about page. */
export default c.define(
  "/src/routes/_site.about.val.ts",
  s.router(
    tanstackRouter,
    s.string().describe("The URL this page is served at"),
    s
      .object({
        title: s.string().maxLength(60),
        image: s.image(imagesVal),
        body: s.richtext({ bold: true, italic: true, h2: true, a: true }),
        team: s
          .array(s.keyOf(authorsVal))
          .describe("Who to show at the bottom of the page"),
      })
      .preview(({ val }) => ({ title: val.title, image: val.image })),
  ),
  {
    "/about": {
      title: "About Northbeam",
      image: { path: "/public/val/images/market_96c7a.jpg" },
      body: [
        {
          tag: "p",
          children: [
            "Northbeam started as a stall at the Saturday market, with a borrowed grinder and a lot of opinions. Five years later we have a roaster, two people, and the same opinions.",
          ],
        },
        { tag: "h2", children: ["What we care about"] },
        {
          tag: "p",
          children: [
            "Knowing where our coffee comes from, paying properly for it, and roasting it ",
            { tag: "span", styles: ["italic"], children: ["just enough"] },
            ".",
          ],
        },
      ],
      team: ["ingrid", "tomas"],
    },
  },
);
