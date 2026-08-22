import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/basic-valid.val") },
  { def: () => import("./content/basic-errors.val") },
  { def: () => import("./content/basic-nested.val") },
]);
