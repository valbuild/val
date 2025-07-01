import { c, nextAppRouter, s } from "_/val.config";

const blogSchema = s.object({
  title: s.string(),
  content: s.string(),
});

export default c.define(
  "/app/blogs/[blog]/page.val.ts",
  s.record(blogSchema).router(nextAppRouter),
  {
    "/blogs/blog2": { title: "Blog 2", content: "Blog 2 content" },
    "/blogs/blog1": { title: "Blog 1", content: "Blog 1 content" },
  },
);
