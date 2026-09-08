import { createFileRoute, notFound } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useVal, useValRoute } from "../val/client";
import pageVal from "./_site.index.val";
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
    throw notFound();
  }
  const author = authors[page.author];
  return (
    <main>
      <h1>{page.hero.title}</h1>
      <p>{site.tagline}</p>
      <ValImage src={page.hero.image} style={{ maxWidth: "16rem" }} />
      <ValRichText content={page.hero.lead} />
      {author && <aside>By {author.name}</aside>}
      <p>{page.tags.join(", ")}</p>
      <footer>{site.footer}</footer>
    </main>
  );
}
