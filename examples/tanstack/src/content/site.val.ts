import { s, c } from "../../val.config";

/**
 * Site-wide content, read with `useVal` rather than through a loader.
 *
 * There to show the difference: this resolves in the component, so it updates
 * in the Studio without the route re-running its loader.
 */
export default c.define(
  "/src/content/site.val.ts",
  s.object({
    footer: s.string(),
    tagline: s.string(),
    /**
     * `.raw()`: a string that is NOT stega encoded.
     *
     * An ordinary `s.string()` reaches the app with the invisible characters
     * that make it click-to-edit woven into it, which is exactly right for
     * anything a person reads and exactly wrong for anything a machine compares:
     * a React `key`, a class name, an id sent to a third party. `.raw()` is the
     * schema saying which of the two this is, and it means the value can no
     * longer be clicked in the canvas — that is the trade, not an oversight.
     */
    analyticsId: s
      .string()
      .raw()
      .regexp(/^[A-Z]{2}-\d{4}$/, "Two capitals, a dash, four digits")
      .describe("Sent to an analytics service, so never stega encoded"),
    /**
     * An array of objects, each of which points at a route this app serves.
     *
     * `.render({ as: "inline" })` makes each row an editable form rather than a
     * row you click into — the right shape for a short list of small items.
     */
    nav: s
      .array(
        s
          .object({
            label: s.string().maxLength(24),
            href: s.route(),
          })
          .render({ as: "inline" })
          .preview(({ val }) => ({ title: val.label, subtitle: val.href })),
      )
      .describe("The links in the site header"),
  }),
  {
    footer: "Built with Val Build",
    tagline: "Content as code, in a TanStack Start app.",
    analyticsId: "VA-0001",
    nav: [
      { label: "Home", href: "/" },
      { label: "Docs", href: "/docs/getting-started" },
      { label: "Showcase", href: "/showcase" },
    ],
  },
);
