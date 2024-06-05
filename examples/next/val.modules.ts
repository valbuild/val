import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./app/content.val") },
  { def: () => import("./components/clientContent.val") },
  { def: () => import("./components/reactServerContent.val") },
  { def: () => import("./components/links.val") },
]);
