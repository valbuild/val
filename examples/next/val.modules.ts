import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./app/blogs/[blog]/page.val") },
  { def: () => import("./app/support/[slug]/page.val") },
  { def: () => import("./app/generic/[[...path]]/page.val") },
  { def: () => import("./content/media.val") },
  { def: () => import("./content/icons.val") },
  { def: () => import("./content/theme.val") },
  { def: () => import("./app/page.val") },
  { def: () => import("./app/external.val") },
  // Fixtures for the .jsonValues() walkthrough (docs/plans/jsonValues-walkthrough.md)
  { def: () => import("./content/kb.val") },
  { def: () => import("./content/tags.val") },
  { def: () => import("./content/featuredContent.val") },
]);
