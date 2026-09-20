import { createFileRoute, Link } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import pageVal, { type Content } from "./_site.index.val";
import { NotFound } from "../components/NotFound";
import authorsVal from "../content/authors.val";
import siteVal from "../content/site.val";

export const Route = createFileRoute("/_site/")({
  component: Home,
});

/**
 * Content read in the component, which is the everyday way.
 *
 * The hooks work in both places a component runs: during SSR they resolve the
 * published content, and in a browser with the Studio open they resolve what
 * the editor currently holds — so an edit appears as you type, with no round
 * trip and no loader. Nothing server-only is imported here, which is what keeps
 * this route out of the server bundle's dependencies.
 */
function Home() {
  const page = useValRoute(pageVal, {});
  const authors = useVal(authorsVal);
  const site = useVal(siteVal);
  if (page === null) {
    /*
     * Returned, not thrown.
     *
     * `notFound()` is for a loader — thrown from a component it escapes into
     * the error boundary, and every miss logs `Error in renderToReadableStream`
     * plus React's "the above error occurred in <Home>" while still rendering
     * the right thing. Reading content in the component is Val's normal path,
     * so a page with no entry has to be an ordinary render, not an exception.
     */
    return <NotFound />;
  }
  const author = authors[page.author];
  return (
    <main>
      <h1>{page.hero.title}</h1>
      <p>{site.tagline}</p>
      <ValImage src={page.hero.image} style={{ maxWidth: "16rem" }} />
      <ValRichText content={page.hero.lead} />
      <p>
        <a href={page.hero.ctaHref}>{page.hero.ctaLabel}</a>
      </p>
      {author && (
        <aside>
          By {author.name}, published {page.published}
        </aside>
      )}
      <p>{page.tags.join(", ")}</p>
      {page.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
      <p>
        <Link to="/showcase">Every other schema type</Link>
      </p>
      <footer>{site.footer}</footer>
    </main>
  );
}

/**
 * One case per variant of the discriminated union.
 *
 * The tag is an ordinary field of the value, so this is a plain `switch` and
 * TypeScript narrows each branch to that variant's own fields. That is the
 * difference a discriminated union buys over an object of optional fields.
 */
function Block({ block }: { block: Content["blocks"][number] }) {
  switch (block.type) {
    case "prose":
      return <ValRichText content={block.body} />;
    case "callout":
      return (
        <aside data-tone={block.tone}>
          <strong>{block.title}</strong>
          <p>{block.text}</p>
          {block.dismissible && <button type="button">Dismiss</button>}
        </aside>
      );
    case "stat":
      return (
        <p>
          {block.label}: <strong>{block.value}</strong>{" "}
          <time dateTime={block.measuredAt}>{block.measuredAt}</time>
        </p>
      );
    case "snippet":
      return (
        <figure>
          {/*
           * `s.code()` is never stega encoded — invisible characters woven into
           * source code are not something a reader can run — so the value
           * reaches the page exactly as it was written.
           */}
          <pre>
            <code>{block.source}</code>
          </pre>
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
  }
}
