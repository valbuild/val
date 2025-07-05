import { s } from "../val.config";
import blogsVal from "../app/blogs/[blog]/page.val";
import genericPageVal from "../app/generic/[[...path]]/page.val";
import { Schema } from "@valbuild/core";
import pageVal from "../app/page.val";

const commons = {
  label: s.string(),
};
export const linkSchema = s.union(
  "type",
  // NOTE: we do `get href() { ... }` to avoid circular dependencies
  s.object({
    ...commons,
    type: s.literal("main"),
    get href(): Schema<string> {
      return s.keyOf(pageVal);
    },
  }),
  s.object({
    ...commons,
    type: s.literal("blog"),
    get href(): Schema<string> {
      return s.keyOf(blogsVal);
    },
  }),
  s.object({
    ...commons,
    type: s.literal("generic"),
    get href(): Schema<string> {
      return s.keyOf(genericPageVal);
    },
  }),
);
