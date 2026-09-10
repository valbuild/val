import { s, c, tanstackRouter } from "../../val.config";

/*
 * A splat route: `src/routes/_site.docs.$.tsx` serves everything under `/docs`.
 *
 * TanStack calls the parameter `_splat`, so that is the name to hand
 * `useValRoute` — which is exactly what the route's own `params` already
 * contains.
 */
export default c.define(
  "/src/routes/_site.docs.$.val.ts",
  s.router(
    tanstackRouter,
    s.object({
      title: s.string(),
      text: s.string(),
    }),
  ),
  {
    "/docs/getting-started": {
      title: "Getting started",
      text: "One entry per path under /docs, however deep.",
    },
    "/docs/guides/routing": {
      title: "Routing",
      text: "A splat route can hold nested paths in the same module.",
    },
  },
);
