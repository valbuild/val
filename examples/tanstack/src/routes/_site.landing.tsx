import { createFileRoute } from "@tanstack/react-router";
import { useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import HeroSection from "../components/sections/HeroSection";
import QuoteSection from "../components/sections/QuoteSection";
import pageVal from "./_site.landing.val";

export const Route = createFileRoute("/_site/landing")({
  component: Landing,
});

/**
 * The page the sections make up. The site renders each section with the same
 * component its schema names for the Studio's preview, so the two cannot
 * drift.
 */
function Landing() {
  const page = useValRoute(pageVal, {});
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main>
      {page.sections.map((section, i) =>
        section.type === "hero" ? (
          <HeroSection key={i} {...section} />
        ) : (
          <QuoteSection key={i} {...section} />
        ),
      )}
    </main>
  );
}
