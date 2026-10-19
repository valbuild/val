import { createFileRoute } from "@tanstack/react-router";
import { ValImage, ValRichText, ValVideo } from "@valbuild/tanstack";
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
      {page.film.video && (
        <section className="film">
          <h2>{page.film.heading}</h2>
          {/*
           * A stream: Safari plays HLS itself, and hls.js is loaded only in a
           * browser that cannot.
           */}
          <ValVideo
            src={page.film.video}
            hls={() => import("hls.js")}
            controls
            muted
            playsInline
          />
        </section>
      )}
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
