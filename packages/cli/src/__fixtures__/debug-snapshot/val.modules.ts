import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/projects.val") },
  { def: () => import("./content/tags.val") },
  { def: () => import("./content/unrelated.val") },
]);
