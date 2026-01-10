import { c, nextAppRouter, s } from "_/val.config";
import authorsVal from "../../../content/authors.val";
import { linkSchema } from "../../../components/link.val";

const blogSchema = s.object({
  title: s.string(),
  content: s.richtext(),
  author: s.keyOf(authorsVal),
  link: linkSchema,
});

export default c.define(
  "/app/blogs/[blog]/page.val.ts",
  s.router(nextAppRouter, blogSchema),
  {
    "/blogs/blog2": {
      title: "Blog 2",
      content: [
        {
          tag: "p",
          children: ["Blog 2 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "Read more",
        href: "/blogs/blog1",
      },
    },
    "/blogs/blog1": {
      title: "Blog 1",
      content: [
        {
          tag: "p",
          children: ["Blog 1 content"],
        },
      ],
      author: "freekh",
      link: {
        label: "See more",
        href: "/generic/test/foo",
      },
    },
  },
);
