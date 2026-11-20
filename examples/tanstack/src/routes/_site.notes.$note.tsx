import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { fetchValRoute } from "../val/server";
import notesVal from "./_site.notes.$note.val";

/**
 * An e2e fixture, not part of the showcase: the Next example's
 * `app/notes/[note]`, a PLAIN router read on the server. Its module is
 * registered only with `VAL_E2E_FIXTURES`; see `val.modules.ts`.
 *
 * The other half of "can I see a page I have not committed": the client half
 * is `/blogs/$blog`, which reads with the hooks. A plain router resolves the
 * whole module on the server, so a page that exists only in an uncommitted
 * patch has to render from there.
 */
const getNote = createServerFn()
  .validator((params: { note: string }) => params)
  .handler(async ({ data }) => {
    return { note: await fetchValRoute(notesVal, data) };
  });

export const Route = createFileRoute("/_site/notes/$note")({
  loader: ({ params }) => getNote({ data: params }),
  component: NotePage,
});

function NotePage() {
  const { note } = Route.useLoaderData();
  if (!note) {
    return <main>Note not found.</main>;
  }
  return (
    <main>
      <h1>{note.title}</h1>
      <p>{note.body}</p>
    </main>
  );
}
