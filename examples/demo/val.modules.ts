import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./src/routes/_site.index.val") },
  { def: () => import("./src/routes/_site.journal.index.val") },
  { def: () => import("./src/routes/_site.journal.$slug.val") },
  { def: () => import("./src/routes/_site.about.val") },
  { def: () => import("./src/content/site.val") },
  { def: () => import("./src/content/authors.val") },
  { def: () => import("./src/content/images.val") },
  { def: () => import("./src/content/videos.val") },
]);
