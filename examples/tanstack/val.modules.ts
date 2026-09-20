import { modules } from "@valbuild/tanstack";
import { config } from "./val.config";

export default modules(config, [
  // The project's settings: one per project, at the root of the content tree.
  { def: () => import("./settings.val") },
  // A route module sits beside the route file it serves and is named after it.
  { def: () => import("./src/routes/_site.index.val") },
  { def: () => import("./src/routes/_site.posts.$postId.val") },
  { def: () => import("./src/routes/_site.docs.$.val") },
  { def: () => import("./src/routes/_site.showcase.val") },
  // Ordinary content modules live wherever you like.
  { def: () => import("./src/content/authors.val") },
  { def: () => import("./src/content/site.val") },
  { def: () => import("./src/content/theme.val") },
  // Media: the two collections first, then the fields that point into them.
  { def: () => import("./src/content/gallery.val") },
  { def: () => import("./src/content/downloads.val") },
  { def: () => import("./src/content/media.val") },
  // Pages that are not in this app, keyed by their whole URL.
  { def: () => import("./src/content/links.val") },
  // Entries in files of their own, loaded one at a time.
  { def: () => import("./src/content/kb.val") },
  // The two ways content says what language it is in.
  { def: () => import("./src/content/translated.val") },
  // `readonly()` and `hidden()`, which only the Studio enforces.
  { def: () => import("./src/content/access.val") },
]);
