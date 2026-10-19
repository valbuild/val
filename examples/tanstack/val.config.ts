import { initVal } from "@valbuild/tanstack";

const { s, c, val, config, tanstackRouter, externalPageRouter } = initVal({
  project: "valbuild/val-examples-tanstack",
  root: "/examples/tanstack",
  defaultTheme: "dark",
  // Content analytics: content read with the hooks is tagged for every
  // visitor after hydration. See docs/plans/analytics.md.
  analytics: { enabled: true },
});

export type { t } from "@valbuild/tanstack";
export { s, c, val, config, tanstackRouter, externalPageRouter };
