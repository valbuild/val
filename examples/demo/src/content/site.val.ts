import { s, c } from "../../val.config";

/** What every page shares: the name, the menu and the footer. */
export default c.define(
  "/src/content/site.val.ts",
  s.object({
    name: s.string().maxLength(40).describe("Shown in the header"),
    menu: s
      .array(
        s.object({
          label: s.string().maxLength(24),
          href: s.route().describe("A page on this site"),
        }),
      )
      .validate((menu) =>
        menu.length > 5 ? "The header has room for five links" : false,
      )
      .describe("The links in the header"),
    footer: s.string().multiline(),
  }),
  {
    name: "Northbeam Coffee",
    menu: [
      { label: "Home", href: "/" },
      { label: "Journal", href: "/journal" },
      { label: "About", href: "/about" },
    ],
    footer:
      "Northbeam Coffee is a small roastery that exists only in this demo. The coffee is imaginary; the content management is real.",
  },
);
