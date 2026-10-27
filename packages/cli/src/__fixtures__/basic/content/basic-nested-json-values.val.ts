import { c, s } from "../val.config";

/**
 * Rejected at validation time: `.jsonValues()` is root-only, and a nested one
 * would silently get no content validation at all.
 */
export default c.define(
  "/content/basic-nested-json-values.val.ts",
  s.object({
    nested: s.record(s.object({ title: s.string() })).jsonValues(),
  }),
  { nested: {} },
);
