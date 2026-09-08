import { createFileRoute, notFound } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import pageVal from "./_site.posts.$postId.val";
import authorsVal from "../content/authors.val";

export const Route = createFileRoute("/_site/posts/$postId")({
  component: Post,
});

function Post() {
  // The route's own params, unchanged: `useValRoute` turns them into the
  // record key by way of the module's file name.
  const post = useValRoute(pageVal, Route.useParams());
  const authors = useVal(authorsVal);
  if (post === null) {
    throw notFound();
  }
  const author = authors[post.author];
  return (
    <main>
      <h1>{post.title}</h1>
      {author && (
        <aside>
          {author.name} — {author.title}
        </aside>
      )}
      <ValRichText content={post.body} />
    </main>
  );
}
