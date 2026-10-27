import { createFileRoute } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import blogsVal from "./_site.blogs.$blog.val";
import authorsVal from "../../content/authors.val";

/**
 * An e2e fixture, not part of the showcase: the blog pages the canvas specs
 * open (`e2e/canvas*.spec.ts`), ported from the Next example's
 * `app/blogs/[blog]`. Its module is registered only with `VAL_E2E_FIXTURES`;
 * see `val.modules.ts`.
 *
 * A router read by a CLIENT component, through the hooks.
 */
export const Route = createFileRoute("/_site/blogs/$blog")({
  component: BlogPage,
});

function BlogPage() {
  const blog = useValRoute(blogsVal, Route.useParams());
  const authors = useVal(authorsVal);
  // Returned rather than thrown — see the note in _site.index.tsx.
  if (!blog) {
    return <NotFound />;
  }
  /*
   * A page that has just been created has no author yet: `s.keyOf` starts
   * empty, so the lookup is undefined on any page made in the Studio and not
   * yet filled in. The page's job is to render what there is.
   */
  const author = blog.author ? authors[blog.author] : undefined;
  return (
    <div>
      <h1>{blog.title}</h1>
      {author && <aside>Author: {author.name}</aside>}
      <ValRichText content={blog.content} />
      <a href={blog.link.href}>{blog.link.label}</a>
    </div>
  );
}
