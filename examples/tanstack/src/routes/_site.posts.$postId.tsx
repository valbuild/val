import { createFileRoute } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
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
  // Returned rather than thrown — see the note in _site.index.tsx.
  if (post === null) {
    return <NotFound />;
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
