import { modules } from "@valbuild/next";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/authors.val") },
  { def: () => import("./app/blogs/[blog]/page.val") },
  { def: () => import("./app/support/[slug]/page.val") },
  { def: () => import("./app/generic/[[...path]]/page.val") },
  { def: () => import("./content/media.val") },
  { def: () => import("./content/theme.val") },
  { def: () => import("./app/page.val") },
  { def: () => import("./app/external.val") },
  // Fixtures for the .jsonValues() walkthrough (docs/plans/jsonValues-walkthrough.md)
  { def: () => import("./content/kb.val") },
  { def: () => import("./content/tags.val") },
  { def: () => import("./content/featuredContent.val") },
  // A handbook: chapters of sections, with a `select` at BOTH array levels —
  // the shape the store benchmark measures against, in an app that really builds
  // and really validates. Small on purpose; see scripts/handbook-fixture.mjs.
  { def: () => import("./content/handbook.val") },
  // The media upload paths: a gallery in a non-default directory, a files
  // gallery, and single image/file fields. See content/mediaFixtures.val.ts.
  { def: () => import("./content/mediaFixtures.val") },
  { def: () => import("./content/fileGallery.val") },
  { def: () => import("./content/mediaFields.val") },
  // A gallery backed by Val's remote file host. See content/remoteImages.val.ts
  // for why this is a gallery and not a single remote image field.
  { def: () => import("./content/remoteImages.val") },
]);
