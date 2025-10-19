import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./app/[locale]/blog/[blog]/en-us.val") },
  { def: () => import("./app/[locale]/blog/[blog]/nb-no.val") },
  { def: () => import("./app/generic/[[...path]]/page.val") },
  { def: () => import("./app/page.val") },
]);
