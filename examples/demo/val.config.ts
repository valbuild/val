import { initVal } from "@valbuild/tanstack";

/*
 * No `project`: the demo belongs to nobody. Without one the Studio offers
 * nothing that needs val.build -- no assistant, no history, no sign-in --
 * which is the demo's shape anyway.
 */
const { s, c, val, config, tanstackRouter } = initVal({
  root: "/examples/demo",
  defaultTheme: "light",
});

export type { t } from "@valbuild/tanstack";
export { s, c, val, config, tanstackRouter };
