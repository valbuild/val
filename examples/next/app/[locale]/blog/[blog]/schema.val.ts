import authorsVal from "../../../../content/authors.val";
import { nextAppRouter, s, t } from "../../../../val.config";

const blogSchema = s.object({
  title: s.string(),
  translations: s.array(
    s.object({
      locale: s.string(),
      key: s.string(),
    }),
  ),
  author: s.keyOf(authorsVal),
  content: s.richtext(),
  link: s.object({
    href: s.string(),
    label: s.string(),
  }),
});

export type Blog = t.inferSchema<typeof blogSchema>;

export const schema = s.record(blogSchema).router(
  nextAppRouter.localize({
    moduleName: "locale",
    segment: "locale",
    translations: "translations",
  }),
);
