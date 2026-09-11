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
  }),
  {
    footer: "Built with Val Build",
    tagline: "Content as code, in a TanStack Start app.",
  },
);
