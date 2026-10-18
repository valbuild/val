import { createFileRoute } from "@tanstack/react-router";
import { useValRoute } from "../val/client";
import pageVal from "./_site.journal.index.val";
import { NotFound } from "../components/NotFound";
import { PostCards } from "../components/PostCards";

export const Route = createFileRoute("/_site/journal/")({
  component: Journal,
});

function Journal() {
  const page = useValRoute(pageVal, {});
  if (page === null) {
    return <NotFound />;
  }
  return (
    <main className="page">
      <h1>{page.title}</h1>
      <p className="intro">{page.intro}</p>
      <PostCards />
    </main>
  );
}
