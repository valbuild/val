import { fetchValRoute } from "../../../val/rsc";
import supportVal from "./page.val";

export default async function SupportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Maps the route params to the matching entry and loads ONLY that entry's
  // backing *.val.json (one dynamic import), not the whole support-pages record.
  const page = await fetchValRoute(supportVal, params);
  if (!page) {
    return <main>Support page not found.</main>;
  }
  return (
    <main>
      <h1>{page.title}</h1>
      <p>{page.body}</p>
    </main>
  );
}
