import { Link, createFileRoute } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import pageVal from "./_site.posts.$postId.val";
import authorsVal from "../content/authors.val";
import { val } from "../../val.config";

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
  // Content that leaves React -- into JSON-LD, or a URL -- goes through
  // `val.raw()`. With content analytics on, the post's strings carry edit tags
  // after hydration, and only JSX attributes and children have them taken
  // out; anywhere else, every visitor (and every crawler) gets them. In
  // development the console names each one that got through.
  const title = val.raw(post.title);
  const shareUrl = `https://bsky.app/intent/compose?text=${encodeURIComponent(title)}`;
  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: title,
            author: author ? val.raw(author.name) : undefined,
          }),
        }}
      />
      <h1>{post.title}</h1>
      {author && (
        <aside>
          {author.name} — {author.title}
        </aside>
      )}
      <ValRichText content={post.body} />
      <p>
        <a href={shareUrl} target="_blank" rel="noreferrer">
          Share this post
        </a>
      </p>
      {/*
       * The router's <Link> renders its <a> with React.createElement, which
       * takes the title as a child argument rather than in props: the one
       * place a string reaches the page outside `jsx`, and is cleaned there.
       */}
      <p>
        Permalink:{" "}
        <Link
          to="/posts/$postId"
          params={Route.useParams()}
          data-testid="permalink"
        >
          {post.title}
        </Link>
      </p>
    </main>
  );
}
