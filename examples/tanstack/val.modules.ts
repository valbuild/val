import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";

export default modules(config, [
  // A route module sits beside the route file it serves and is named after it.
  { def: () => import("./src/routes/_site.index.val") },
  { def: () => import("./src/routes/_site.posts.$postId.val") },
  { def: () => import("./src/routes/_site.docs.$.val") },
  // Ordinary content modules live wherever you like.
  { def: () => import("./src/content/authors.val") },
  { def: () => import("./src/content/site.val") },
]);
