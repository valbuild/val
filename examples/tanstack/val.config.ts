import { initVal } from "@valbuild/tanstack";

const { s, c, val, config, tanstackRouter, externalPageRouter } = initVal({
  project: "valbuild/val-examples-tanstack",
  root: "/examples/tanstack",
  defaultTheme: "dark",
});

export type { t } from "@valbuild/tanstack";
export { s, c, val, config, tanstackRouter, externalPageRouter };
