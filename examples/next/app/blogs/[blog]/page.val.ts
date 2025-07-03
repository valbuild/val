import { c, nextAppRouter, s } from "_/val.config";
import authorsVal from "../../../content/authors.val";
import { linkButtonSchema } from "../../../components/linkButton.val";

const blogSchema = s.object({
  title: s.string(),
  content: s.string(),
  author: s.keyOf(authorsVal),
  link: linkButtonSchema,
});

export default c.define(
  "/app/blogs/[blog]/page.val.ts",
  s.record(blogSchema).router(nextAppRouter),
  {
    "/blogs/blog2": {
      title: "Blog 2",
      content: "Blog 2 content",
      author: "freekh",
      link: {
        label: "Read more",
        link: {
          type: "blog",
          href: "/blogs/blog1",
        },
      },
    },
    "/blogs/blog1": {
      title: "Blog 1",
      content: "Blog 1 content",
      author: "freekh",
      link: {
        label: "See more",
        link: {
          type: "generic",
          href: "/generic/test/foo",
        },
      },
    },
  },
);
