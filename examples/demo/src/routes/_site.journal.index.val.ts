import { s, c, tanstackRouter } from "../../val.config";

/** The journal's front page: its heading. The posts are their own module. */
export default c.define(
  "/src/routes/_site.journal.index.val.ts",
  s.router(
    tanstackRouter,
    s.string().describe("The URL this page is served at"),
    s
      .object({
        title: s.string().maxLength(60),
        intro: s.string().multiline(),
      })
      .preview(({ val }) => ({ title: val.title })),
  ),
  {
    "/journal": {
      title: "Journal",
      intro:
        "Notes from the roastery: where our coffee comes from, how we roast it, and what we drink on a Friday.",
    },
  },
);
