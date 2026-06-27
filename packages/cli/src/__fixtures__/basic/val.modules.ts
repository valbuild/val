import { modules } from "@valbuild/core";
import { config } from "./val.config";

export default modules(config, [
  { def: () => import("./content/basic-valid.val") },
  { def: () => import("./content/basic-errors.val") },
  { def: () => import("./content/basic-files.val") },
  { def: () => import("./content/basic-image.val") },
  { def: () => import("./content/basic-image-from-gallery.val") },
  { def: () => import("./content/basic-image-from-galleries.val") },
  { def: () => import("./content/basic-gallery.val") },
  { def: () => import("./content/basic-gallery-2.val") },
  { def: () => import("./content/basic-gallery-fail-on-non-unique-dir.val") },
  { def: () => import("./content/basic-gallery-missing-tracked.val") },
  { def: () => import("./content/basic-gallery-wrong-metadata.val") },
]);
