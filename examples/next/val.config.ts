import { initVal } from "@valbuild/next";

const { s, c, val, config } = initVal({
  remote: "freekh/val-next-example",
});

export type { t } from "@valbuild/next";
export { s, c, val, config };
