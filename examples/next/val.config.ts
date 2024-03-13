import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal({
  remote: "freekh/val-next-example",
  root: "examples/next",
});

export type { t } from "@valbuild/next";
export { s, c, val, config };
