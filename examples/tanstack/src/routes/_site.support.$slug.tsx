import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { fetchValRoute } from "../val/server";
import supportVal from "./_site.support.$slug.val";

/**
 * An e2e fixture, not part of the showcase: the Next example's
 * `app/support/[slug]`, a `.jsonValues()` router read on the SERVER. Its
 * module is registered only with `VAL_E2E_FIXTURES`; see `val.modules.ts`.
 *
 * Through `createServerFn` for the reason `_site.docs.$.tsx` gives. Maps the
 * route params to the matching entry and loads ONLY that entry's backing
 * `*.val.json`, not the whole record.
 */
const getSupportPage = createServerFn()
  .validator((params: { slug: string }) => params)
  .handler(async ({ data }) => {
    return { page: await fetchValRoute(supportVal, data) };
  });

export const Route = createFileRoute("/_site/support/$slug")({
  loader: ({ params }) => getSupportPage({ data: params }),
  component: SupportPage,
});

function SupportPage() {
  const { page } = Route.useLoaderData();
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
