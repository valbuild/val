import { c, s } from "../val.config";

/**
 * A `.jsonValues()` record with an inline entry whose value ALSO fails the item
 * schema at the entry's own path: the string is shorter than the minimum.
 *
 * Two validations report at the same source path — the record-level one (which
 * checks the inline value against the item schema) and the jsonValues one (which
 * reports the inlining). Both have to survive being merged into the module's
 * validation errors.
 */
export default c.define(
  "/content/basic-inline-json-values-invalid.val.ts",
  s.record(s.string().minLength(5)).jsonValues(),
  {
    "/inline": "ab",
  },
);
