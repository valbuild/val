import { c, nextAppRouter, s } from "_/val.config";
import { linkSchema } from "../../../components/link";
import authorsVal from "../../../content/authors.val";

const blogSchema = s.object({
  title: s.string(),
  content: s.string(),
  author: s.keyOf(authorsVal),
  link: linkSchema,
});

export default c.define(
  "/app/blogs/[blog]/page.val.ts",
  s.record(blogSchema).router(nextAppRouter),
  {
    "/blogs/blog2": {
      title: "Blog 2",
      content: "Blog 2 content",
      author: "author2",
      link: {
        type: "generic",
        href: "/generic/test/foo",
      },
    },
    "/blogs/blog1": {
      title: "Blog 1",
      content: "Blog 1 content",
      author: "author1",
      link: {
        type: "generic",
        href: "/generic/test/foo",
      },
    },
  },
);
