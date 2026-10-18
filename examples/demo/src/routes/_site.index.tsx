import { createFileRoute } from "@tanstack/react-router";
import { ValImage, ValRichText } from "@valbuild/tanstack";
import { useValRoute } from "../val/client";
import pageVal from "./_site.index.val";
import { NotFound } from "../components/NotFound";
import { PostCards } from "../components/PostCards";

export const Route = createFileRoute("/_site/")({
  component: Home,
});

function Home() {
  const page = useValRoute(pageVal, {});
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main>
      <section className="hero">
        <div className="hero-text">
          <h1>{page.hero.title}</h1>
          <ValRichText content={page.hero.lead} />
          <a className="button" href={page.hero.ctaHref}>
            {page.hero.ctaLabel}
          </a>
        </div>
        <ValImage className="hero-image" src={page.hero.image} />
      </section>
      <section className="features">
        {page.features.map((feature, i) => (
          <article key={i} className="feature">
            <h2>{feature.title}</h2>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>
      <blockquote className="quote">
        <p>“{page.quote.text}”</p>
        <cite>{page.quote.by}</cite>
      </blockquote>
      <section className="page">
        <h2>{page.journalHeading}</h2>
        <PostCards limit={3} />
      </section>
    </main>
  );
}
