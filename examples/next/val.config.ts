import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal({
  remote: "valbuild/val-examples-next",
  root: "/examples/next",
});

export type { t } from "@valbuild/next";
export { s, c, val, config };
