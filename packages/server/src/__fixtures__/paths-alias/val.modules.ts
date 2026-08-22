import { modules } from "@valbuild/core";
import { config } from "_/val.config";

export default modules(config, [
  { def: () => import("./src/content/page.val") },
]);
