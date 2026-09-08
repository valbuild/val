import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { fetchValRoute } from "../val/server";
import pageVal from "./_site.docs.$.val";

/**
 * The same content, read on the SERVER instead — the other half of the story.
 *
 * Reach for this when the content has to exist before the component does:
 * `head`/meta tags, a redirect decided by content, a `notFound()` that must
 * happen during the request rather than during render.
 *
 * It HAS to go through `createServerFn`. A route `loader` runs in the browser
 * too — that is what makes a client navigation work — so importing
 * `../val/server` straight into a loader pulls `@valbuild/server`, and Node's
 * `fs` with it, into the client bundle. `createServerFn` is compiled away on
 * the client and replaced with a fetch, and everything only its handler uses
 * goes with it.
 *
 * The cost, and the reason the other two routes read with hooks instead:
 * content that arrives through a loader on a FIRST (server-rendered) load is
 * not click-to-editable. The edit tags are attached as JSX is created, and Val
 * only starts attaching them after hydration has told it the Studio is open —
 * by which time this component has already rendered its loader data once. A
 * client-side navigation to the same route tags it normally. So: hooks for
 * content an editor should be able to click, loaders for content the request
 * has to decide on.
 */
const getDoc = createServerFn()
  .validator((params: { _splat?: string }) => params)
  .handler(async ({ data }) => {
    return { doc: await fetchValRoute(pageVal, data) };
  });

export const Route = createFileRoute("/_site/docs/$")({
  loader: async ({ params }) => {
    const { doc } = await getDoc({ data: params });
    if (!doc) {
      throw notFound();
    }
    return { doc };
  },
  component: Doc,
});

function Doc() {
  const { doc } = Route.useLoaderData();
  return (
    <main>
      <h1>{doc.title}</h1>
      <p>{doc.text}</p>
    </main>
  );
}
