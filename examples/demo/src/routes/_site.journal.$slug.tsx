import { createFileRoute } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import postVal from "./_site.journal.$slug.val";
import authorsVal from "../content/authors.val";
import { NotFound } from "../components/NotFound";

export const Route = createFileRoute("/_site/journal/$slug")({
  component: Post,
});

function Post() {
  const post = useValRoute(postVal, Route.useParams());
  const authors = useVal(authorsVal);
  if (post === null) {
    return <NotFound />;
  }
  const author = authors[post.author];
  return (
    <main className="page post">
      <ValImage className="cover" src={post.cover} />
      <h1>{post.title}</h1>
      {author && (
        <p className="byline">
          <ValImage className="avatar" src={author.portrait} />
          <span>
            {author.name}, {author.role} · {post.publishedAt}
          </span>
        </p>
      )}
      <div className="prose">
        <ValRichText content={post.body} />
      </div>
    </main>
  );
}
