import { createFileRoute } from "@tanstack/react-router";
import { ValRichText } from "@valbuild/tanstack";
import { useValRoute } from "../val/client";
import { NotFound } from "../components/NotFound";
import newsVal from "./_site.{-$locale}.news.$slug.val";

export const Route = createFileRoute("/_site/{-$locale}/news/$slug")({
  component: News,
});

function News() {
  // `locale` is undefined on `/news/…`: an optional segment the URL left out
  // adds nothing to the key, so the params are handed over unchanged.
  const params = Route.useParams();
  const news = useValRoute(newsVal, params);
  // Returned rather than thrown — see the note in _site.index.tsx.
  if (news === null) {
    return <NotFound />;
  }
  return (
    <main>
      <h1>{news.title}</h1>
      <ValRichText content={news.body} />
    </main>
  );
}
