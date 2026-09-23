import { s, c, tanstackRouter } from "../../val.config";
import authorsVal from "../content/authors.val";
import galleryVal from "../content/gallery.val";

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
    s.string().describe("The URL of this post. Lower case, no spaces"),
    s
      .object({
        title: s.string(),
        author: s.keyOf(authorsVal),
        /** A gallery-backed image: only the path is stored on the post. */
        cover: s.image(galleryVal).nullable(),
        publishedAt: s.datetime().describe("Shown as the byline date"),
        draft: s.boolean().describe("Drafts are still served, just marked"),
        /**
         * `.minLength()` / `.maxLength()` on a richtext count CHARACTERS, not
         * nodes — so they are a limit on what an editor wrote, not on how they
         * marked it up.
         */
        body: s
          .richtext({ bold: true, italic: true, h2: true, ul: true })
          .minLength(10)
          .maxLength(20_000),
      })
      // A preview is a TITLE — what this post is CALLED wherever it is referred
      // to. It is never a location: the breadcrumb and the Pages tree are made
      // of path segments, and a title that changes as an editor types is not a
      // place.
      .preview(({ val }) => ({
        title: val.title,
        subtitle: val.author,
        image: val.cover,
      })),
  ),
  {
    "/posts/hello-world": {
      title: "Hello world",
      author: "freekh",
      cover: { path: "/public/val/gallery/brand-blue_9e87d.png" },
      publishedAt: "2025-01-09T09:00:00.000Z",
      draft: false,
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
      cover: null,
      publishedAt: "2025-02-01T09:00:00.000Z",
      draft: true,
      body: [{ tag: "p", children: ["The keys of the record are the URLs."] }],
    },
  },
);
