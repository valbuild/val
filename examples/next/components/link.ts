import { s } from "../val.config";
import blogsVal from "../app/blogs/[blog]/page.val";
import genericPageVal from "../app/generic/[[...path]]/page.val";
import { Schema } from "@valbuild/core";
import pageVal from "../app/page.val";

export const linkSchema: Schema<{
  type: "main" | "blog" | "generic";
  href: string;
}> = s.union(
  "type",
  s.object({
    type: s.literal("main"),
    get href() {
      return s.keyOf(pageVal);
    },
  }),
  s.object({
    type: s.literal("blog"),
    get href() {
      return s.keyOf(blogsVal);
    },
  }),
  s.object({
    type: s.literal("generic"),
    get href() {
      return s.keyOf(genericPageVal);
    },
  }),
);
