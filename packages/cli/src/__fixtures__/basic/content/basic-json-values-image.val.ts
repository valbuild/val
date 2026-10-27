import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record whose entry content contains an `s.image()`. Image
 * metadata can only be checked by reading the bytes, so validating an image
 * ALWAYS produces a fix — which means every fix handler has to cope with a
 * source path that points inside an entry whose content is not in the
 * `.val.ts`.
 */
export default c.define(
  "/content/basic-json-values-image.val.ts",
  s.record(s.object({ title: s.string(), image: s.image() })).jsonValues(),
  {
    "/with-image": c.json(() => import("./json-entries/with-image.val.json")),
  },
);
