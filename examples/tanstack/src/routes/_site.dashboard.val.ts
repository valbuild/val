import { s, c, tanstackRouter } from "../../val.config";

/*
 * A page only a signed-in visitor can see: `src/routes/_site.dashboard.tsx`
 * sends everyone else to `/login`. Editing it in the Studio works the same as
 * any other page, because the canvas is the site itself, signed in as you.
 */
export default c.define(
  "/src/routes/_site.dashboard.val.ts",
  s.router(
    tanstackRouter,
    s
      .object({
        title: s.string(),
        welcome: s.string().multiline(),
      })
      .preview(({ val }) => ({ title: val.title, subtitle: val.welcome })),
  ),
  {
    "/dashboard": {
      title: "Your dashboard",
      welcome:
        "Only signed-in visitors get this far. Edit this text in the Studio and the canvas follows, signed in as you.",
    },
  },
);
