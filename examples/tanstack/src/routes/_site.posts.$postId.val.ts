import { s, c, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";

/*
 * A dynamic route: `src/routes/_site.posts.$postId.tsx` is served by this file.
 *
 * `$postId` is a parameter, so this module holds one entry per post and the
 * keys are the URLs. Directory notation (`src/routes/_site/posts.$postId.val.ts`) is
 * the same route — pick whichever you use for the route file itself.
 */
export default c.define(
  "/src/routes/_site.posts.$postId.val.ts",
  s.router(
    tanstackRouter,
    s.object({
      title: s.string(),
      author: s.keyOf(authorsVal),
      body: s.richtext({ bold: true, italic: true, h2: true, ul: true }),
    }),
  ),
  {
    "/posts/hello-world": {
      title: "Hello world",
      author: "freekh",
      body: [
        {
          tag: "p",
          children: [
            "Add a post by adding a key to this record — in the Studio, or here.",
          ],
        },
      ],
    },
    "/posts/second-post": {
      title: "A second post",
      author: "ada",
      body: [{ tag: "p", children: ["The keys of the record are the URLs."] }],
    },
  },
);
