import { createFileRoute } from "@tanstack/react-router";
import { ValComponentEditor } from "@valbuild/tanstack";
import { useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import pageVal from "./_site.landing.val";

export const Route = createFileRoute("/_site/landing")({
  component: Landing,
});

/**
 * The page the sections make up.
 *
 * `ValComponentEditor` renders each section with the component its schema
 * links it to (`_site.landing.val.ts`), which is also the one the Studio
 * previews it with, so the two cannot drift. In the Studio the sections can
 * be arranged on this page; for a visitor it is the components and nothing
 * else. It takes a single object as well as a list: `callToAction` is one.
 *
 * It is optional, and only what is handed to it is its business: the heading
 * below is ordinary JSX, and the sections could be a `map` with a `switch`.
 */
function Landing() {
  const page = useValRoute(pageVal, {});
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main>
      <p style={{ padding: "1rem 1.5rem 0", color: "var(--muted)" }}>
        {page.title}
      </p>
      <ValComponentEditor value={page.sections} />
      <ValComponentEditor value={page.callToAction} />
    </main>
  );
}
