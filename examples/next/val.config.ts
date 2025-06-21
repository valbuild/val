import { initVal } from "@valbuild/next";

const { s, c, val, config, nextAppRouter } = initVal({
  project: "valbuild/val-examples-next",
  root: "/examples/next",
  defaultTheme: "dark",
});

export type { t } from "@valbuild/next";
export { s, c, val, config, nextAppRouter };
