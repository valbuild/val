import { createFileRoute } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import pageVal from "./_site.index.val";
import { NotFound } from "../components/NotFound";
import siteVal from "../content/site.val";

export const Route = createFileRoute("/_site/")({
  component: Home,
});

/** What the route's entry reads as, so the child below can be typed from it. */
type PageContent = NonNullable<ReturnType<typeof useValRoute<typeof pageVal>>>;

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
  return (
    <main>
      <h1>{page.hero.title}</h1>
      <p>{site.tagline}</p>
      <ValImage src={page.hero.image} style={{ maxWidth: "16rem" }} />
      <ValRichText content={page.hero.lead} />
      <Authors authors={page.authors} authorKey={page.author} />
      <p>{page.tags.join(", ")}</p>
      <footer>{site.footer}</footer>
    </main>
  );
}

/**
 * The authors module, read through the page's own `s.view()` field.
 *
 * `page.authors` is a pointer — `{ view: "/src/content/authors.val.ts" }` — so
 * this is the same content `useVal(authorsVal)` would give. What it buys is that
 * the page DECLARES which module it shows and this component follows that
 * declaration: point the schema's `s.view()` somewhere else and the read follows,
 * where the import it replaces would have gone on reading authors.
 *
 * Its own component because `page` can be `null` and a hook cannot be: reading
 * the view where `page.authors` exists means reading it after the early return
 * above, which is exactly what the rules of hooks forbid. A child that is only
 * mounted once there IS a page keeps every hook unconditional.
 */
function Authors({
  authors: authorsView,
  authorKey,
}: {
  authors: PageContent["authors"];
  authorKey: string;
}) {
  const authors = useVal(authorsView);
  const author = authors[authorKey];
  return (
    <>
      {author && <aside>By {author.name}</aside>}
      {/*
       * Everyone in the viewed module, not just the one `s.keyOf` picked —
       * which is the point of reading the whole thing rather than a key.
       */}
      <aside>
        Authors:{" "}
        {Object.values(authors)
          .map((a) => a.name)
          .join(", ")}
      </aside>
    </>
  );
}
